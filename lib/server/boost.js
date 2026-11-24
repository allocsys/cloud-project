// Boost tickets: settings, buying a ticket, and settling finished boosts. Rules and maths: lib/boost.js. Storage: lib/server/db.js.
// Settings live in the meta entry "boost" { enabled, chance: { t1, t10, t100 }, shown: { t1, t10, t100 } } (percent; shown null = same as chance). `chance` is the real
// chance (draw and margin); users only ever get the shown one. A change reaches every server within a few seconds.
// A ticket is paid from the balance, through the same steps as a plan (account locked, balance checked, spend written to the ledger).
// The draw is made at purchase with a secure random number and stored on the boost, but nothing shows it until the boost ends.
// When a boost ends its pay and prize are already part of the balance (lib/boost.js boostBtcOf); settling only writes what the user sees
// (activity, notification) and the ledger rows, once per boost. It runs when the user opens the boosts and from the timer in renew.js.
import { randomBytes, randomInt } from 'node:crypto';
import { BOOST, TICKETS, ticketOf, normalizeBoost, boostOn, marginOf, activeCount, drawWins, boostResultUsd, shownOf, floatedShown, WINNERS, maskId, mockWinners, pickWinners, KEEP_SETTLED, giftBoost, GIFT_TICKET, MAX_QTY, AUTO } from '@/lib/boost';
import { warm, metaGet, metaUpdate, getUser, withUser, withIdem, idemGet, ledger, notify, q } from '@/lib/server/db';
import { pricesFor, NO_PRICE } from '@/lib/server/prices';
import { availableIn, TOLERANCE } from '@/lib/server/wallet';
import { getMarket, getLive } from '@/lib/server/market';
import { claimVipTickets } from '@/lib/server/referrals';

const fail = (status, error, extra = {}) => ({ ok: false, status, error, ...extra });
const cents = (n) => Math.round(n * 100) / 100;

export async function boostSettings() {
  await warm();
  return normalizeBoost(metaGet('boost'));
}

const num = (v) => (v === null || v === undefined || String(v).trim() === '' ? NaN : Number(String(v).trim().replace(',', '.')));

// Saves what is given and leaves the rest as it is, so the switch can be flipped on its own. `chance` is { t1?, t10?, t100? } in percent.
// A chance that leaves a ticket with a negative margin is refused unless `confirm` is true (the admin screen asks the second time).
// `shown` is the same shape: the chance users see, empty or null = same as the real one. It does not touch the margin.
export async function saveBoostSettings(input) {
  const patch = {};
  if (input?.enabled !== undefined) patch.enabled = input.enabled === true || input.enabled === 'true';
  const chance = {};
  if (input?.chance && typeof input.chance === 'object') {
    for (const t of TICKETS) {
      if (input.chance[t.id] === undefined) continue;
      const v = num(input.chance[t.id]);
      if (!(v >= 0 && v <= BOOST.maxChance)) return fail(422, `Chance for the $${t.price} ticket must be between 0 and ${BOOST.maxChance}%.`);
      chance[t.id] = cents(v);
    }
  }
  const shown = {};
  if (input?.shown && typeof input.shown === 'object') {
    for (const t of TICKETS) {
      const raw = input.shown[t.id];
      if (raw === undefined) continue;
      if (raw === null || String(raw).trim() === '') {
        shown[t.id] = null;
        continue;
      }
      const v = num(raw);
      if (!(v >= 0 && v <= BOOST.maxChance)) return fail(422, `Shown chance for the $${t.price} ticket must be between 0 and ${BOOST.maxChance}%, or empty.`);
      shown[t.id] = cents(v);
    }
  }
  // `float` is { on?, band?, recalibrate? }: the shown chance follows network difficulty (display only). Turning it on (or recalibrate: true) stores
  // today's difficulty as the reference, so the shown chance starts exactly at its base. Without a difficulty reading it stays uncalibrated.
  const fl = input?.float && typeof input.float === 'object' ? input.float : null;
  const floatPatch = {};
  if (fl) {
    if (fl.on !== undefined) floatPatch.on = fl.on === true || fl.on === 'true';
    if (fl.band !== undefined) {
      const b = num(fl.band);
      if (!(b >= 0 && b <= 100)) return fail(422, 'The float band must be between 0 and 100%.');
      floatPatch.band = cents(b);
    }
  }
  // `auto` is { on }: the admin switch for auto buy (users can only turn it on while it is on).
  const autoPatch = {};
  if (input?.auto && typeof input.auto === 'object' && input.auto.on !== undefined) autoPatch.on = input.auto.on === true || input.auto.on === 'true';
  const live = fl ? await getLive().catch(() => null) : null;
  return metaUpdate('boost', (cur) => {
    const base = normalizeBoost(cur);
    const float = { ...base.float, ...floatPatch };
    if (fl && float.on && (fl.recalibrate === true || !float.ref) && live?.difficulty > 0) float.ref = live.difficulty;
    const next = normalizeBoost({ ...base, ...patch, chance: { ...base.chance, ...chance }, shown: { ...base.shown, ...shown }, float, auto: { ...base.auto, ...autoPatch } });
    const losing = TICKETS.filter((t) => chance[t.id] !== undefined && marginOf(t, next.chance[t.id]) < 0);
    if (losing.length && input?.confirm !== true) {
      return { result: fail(409, `The $${losing.map((t) => t.price).join(', $')} ticket would lose money at this chance. Confirm to save it anyway.`, { needConfirm: true }) };
    }
    return { value: next, result: { ok: true, status: 200, settings: next } };
  });
}

// ---- Buying ----

// Buys a ticket (or `qty` of them, 1 to MAX_QTY, default 1) from the balance and starts a boost for each, every one with its own id and its own draw.
// All of them go through in one locked request: the running limit and the balance are checked for the whole amount, or nothing is bought.
// Same Idempotency-Key twice returns the first result instead of buying twice.
// `auto` is set only by the auto buy below (never from a request): it changes the notification text.
export async function buyBoost(input, { userId = 'demo', key, auto = false } = {}) {
  const idemKey = key ? `boost:${userId}:${key}` : null;
  const prior = await idemGet(idemKey);
  if (prior) return prior;
  const cfg = await boostSettings();
  if (!boostOn(cfg)) return fail(409, 'Boost tickets are not available right now.');
  const free = input?.free === true; // a free ticket (u.freeTickets) instead of the balance: always the $1 ticket
  const t = ticketOf(free ? GIFT_TICKET : String(input?.ticket ?? ''));
  if (!t) return fail(400, 'Unknown ticket.');
  const qty = free || input?.qty === undefined || input?.qty === null ? 1 : Number(input.qty); // a free ticket is always one
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) return fail(400, 'Unknown amount.');
  const pr = await pricesFor(['btc']);
  if (!pr.ok) return fail(503, NO_PRICE);
  const market = await getMarket(); // warms the market cache now, so nothing slow happens while the account is locked
  const rate = pr.prices.btc;
  if (!(rate > 0)) return fail(503, NO_PRICE);
  const cost = Math.ceil((t.price / rate) * 1e8) / 1e8;
  const chance = cfg.chance[t.id]; // the real chance: read now, fixed on the boost below
  const shown = floatedShown(cfg, t.id, market.live?.difficulty); // what the user was told (follows the network when the float is on), fixed on the boost too

  return withUser(userId, (u, c) =>
    withIdem(c, idemKey, async () => {
      if (!u) return fail(404, 'Account not found.');
      const now = Date.now();
      if (free) {
        // Uses one held free ticket: nothing is spent and the balance is not touched. Free boosts never count against the running limit (activeCount).
        if (!((u.freeTickets || 0) > 0)) return fail(409, 'You have no free tickets.');
        u.freeTickets -= 1;
        const gift = giftBoost({ id: `bst_${randomBytes(6).toString('base64url')}`, cfg, rate, now, roll: randomInt(1_000_000) });
        (u.boosts ||= []).push(gift);
        u.history.unshift({ kind: 'boost-buy', label: `Free boost ticket · $${t.price}`, date: 'Just now', at: now, amount: 'Free', net: 'Balance' });
        notify(u, { kind: 'purchase', title: 'Boost started', body: `${t.th.toLocaleString('en-US')} TH/s for ${BOOST.hours} hours.`, code: 'boost', vars: { th: t.th.toLocaleString('en-US'), h: BOOST.hours } });
        return { ok: true, status: 200, boost: publicBoost(gift, now), spentBtc: 0 };
      }
      if (activeCount(u, t.id, now) + qty > t.max) return fail(409, `You can have up to ${t.max} of this boost running at once.`);
      // A deposit inside its hold (no plan yet) can pay for a ticket. The ticket is spent from the balance while the lot stays locked,
      // so what the boost pays back stays behind the hold too (wallet.js withdraw: available - lockedBtc).
      if (cost * qty > (await availableIn(c, u, market)) + TOLERANCE) return fail(409, 'Not enough balance for this ticket.');
      const made = [];
      for (let i = 0; i < qty; i += 1) {
        const boost = {
          id: `bst_${randomBytes(6).toString('base64url')}`,
          t: t.id,
          price: t.price,
          th: t.th,
          pay: t.pay,
          prize: t.prize,
          chance,
          shown,
          win: drawWins(chance, randomInt(1_000_000)), // its own draw
          rate,
          startAt: now,
          endsAt: now + BOOST.hours * 3600_000,
          settled: false,
        };
        (u.boosts ||= []).push(boost);
        u.spent = (u.spent || 0) + cost;
        made.push(boost);
      }
      const total = t.price * qty;
      const th = (t.th * qty).toLocaleString('en-US');
      u.history.unshift({ kind: 'boost-buy', label: qty > 1 ? `Boost ticket x${qty} · $${total}` : `Boost ticket · $${t.price}`, date: 'Just now', at: now, amount: `-$${total}`, net: 'Balance' });
      notify(u, auto ? { kind: 'purchase', title: 'Auto boost started', body: `${th} TH/s for ${BOOST.hours} hours.`, code: 'boostAuto', vars: { q: qty, th, h: BOOST.hours } } : { kind: 'purchase', title: 'Boost started', body: `${th} TH/s for ${BOOST.hours} hours.`, code: 'boost', vars: { th, h: BOOST.hours } });
      for (const boost of made) await ledger(c, userId, 'spend', { btc: cost, usd: t.price, ref: `Boost ticket $${t.price} ${boost.id}` }); // one row per boost
      return { ok: true, status: 200, boost: publicBoost(made[0], now), boosts: made.map((b) => publicBoost(b, now)), qty, spentBtc: Math.round(cost * qty * 1e8) / 1e8 };
    }),
  );
}

// ---- Auto buy ----
// A user can have the $1 ticket bought for them once a day: u.autoBoost = { on, qty, lastDay (UTC day number of the last try), nextAt (ms) }.
// The timer in renew.js calls autoBuyDue. Each user has their own random moment (lib/boost.js AUTO), so buys spread over the day instead of
// landing together. The buy is the normal one (buyBoost: balance and running limit checked, nothing is bought in part) with a per-day key,
// so it can never happen twice in a day, even if a round dies halfway or two servers run at once.

const DAY = 86_400_000;
const dayOf = (ms) => Math.floor(ms / DAY);
const slotOn = (day) => day * DAY + randomInt(AUTO.from, AUTO.to); // a random moment of that UTC day

// What a user may read about their own auto buy.
const autoPublic = (a, cfg) => ({ available: boostOn(cfg) && cfg.auto.on, on: a?.on === true, qty: Number(a?.qty) >= 1 ? Number(a.qty) : 1, max: AUTO.maxQty });

// Turns the user's auto buy on (`qty` tickets a day, 1 to AUTO.maxQty) or off. Turning it on needs tickets on and auto buy switched on by the admin.
// The first buy comes a few minutes to a few hours later the same UTC day, or at a random moment tomorrow if today was already tried or is nearly over.
export async function setAutoBoost(input, { userId = 'demo' } = {}) {
  const cfg = await boostSettings();
  const on = input?.on === true || input?.on === 'true';
  const qty = Number(input?.qty);
  if (on) {
    if (!boostOn(cfg) || !cfg.auto.on) return fail(409, 'Boost tickets are not available right now.');
    if (!Number.isInteger(qty) || qty < 1 || qty > AUTO.maxQty) return fail(400, 'Unknown amount.');
  }
  return withUser(userId, (u) => {
    if (!u) return fail(404, 'Account not found.');
    const cur = u.autoBoost || {};
    const now = Date.now();
    const today = dayOf(now);
    let nextAt = on && cur.on && Number(cur.nextAt) > 0 ? Number(cur.nextAt) : null; // already on: a new amount keeps its moment
    if (on && !nextAt) {
      const first = now + randomInt(AUTO.firstMin, AUTO.firstMax);
      nextAt = cur.lastDay === today || dayOf(first) !== today ? slotOn(today + 1) : first;
    }
    u.autoBoost = { on, qty: on ? qty : Number(cur.qty) >= 1 ? Number(cur.qty) : 1, lastDay: cur.lastDay ?? null, nextAt };
    return { ok: true, status: 200, auto: autoPublic(u.autoBoost, cfg) };
  });
}

// One account's auto buy, when it is due. Returns the tickets bought (0 when skipped, not due, or waiting for a price).
async function autoBuyOne(userId, now) {
  const a = (await getUser(userId))?.autoBoost;
  if (!a?.on || !(Number(a.nextAt) <= now)) return 0;
  const today = dayOf(now);
  let bought = 0;
  let skipped = false;
  if (a.lastDay !== today) {
    const r = await buyBoost({ ticket: AUTO.ticket, qty: a.qty }, { userId, key: `auto:${today}`, auto: true });
    if (r.status === 503) return 0; // no price right now: the next round tries again
    if (r.ok) bought = a.qty;
    else skipped = true; // short balance or the running limit is full: not today, the user is told
  }
  await withUser(userId, (u) => {
    const cur = u?.autoBoost;
    if (!cur?.on) return;
    u.autoBoost = { ...cur, lastDay: today, nextAt: slotOn(today + 1) };
    if (skipped) notify(u, { kind: 'purchase', title: 'Auto boost skipped', body: 'Not enough balance or too many boosts running. We will try again tomorrow.', code: 'boostAutoSkip', vars: {} });
  });
  return bought;
}

// Buys for every account that is due (called by the timer in renew.js), at most AUTO.batch per round; the rest are still due next round.
// Returns how many tickets were bought. Does nothing while tickets or auto buy are off.
export async function autoBuyDue(now = Date.now()) {
  const cfg = await boostSettings();
  if (!boostOn(cfg) || !cfg.auto.on) return 0;
  // The WHERE and the ORDER BY are the ones of the partial index users_auto_boost_idx (migration 002), so only due accounts are read.
  const ids = (
    await q(
      `SELECT id FROM users WHERE data->'autoBoost' @> '{"on": true}'::jsonb AND (data->'autoBoost'->>'nextAt')::bigint <= $1
        ORDER BY (data->'autoBoost'->>'nextAt')::bigint LIMIT $2`,
      [now, AUTO.batch],
    )
  ).rows.map((r) => r.id);
  let n = 0;
  for (const id of ids) {
    try {
      n += await autoBuyOne(id, now);
    } catch (e) {
      console.error(`[boost] auto buy ${id} failed:`, e.message);
    }
  }
  return n;
}

// ---- Settling ----

// Finished boosts that have not been settled: writes the ledger rows, the activity line and the notification, once each.
async function settleIn(c, u, now = Date.now()) {
  let n = 0;
  for (const b of u.boosts || []) {
    if (b.settled || now < b.endsAt) continue;
    b.settled = true;
    n += 1;
    const toBtc = (usd) => Math.round((usd / b.rate) * 1e8) / 1e8;
    await ledger(c, u.id, 'boost-pay', { btc: toBtc(b.pay), usd: b.pay, ref: `Boost $${b.price} ${b.id}` });
    if (b.win) await ledger(c, u.id, 'boost-prize', { btc: toBtc(b.prize), usd: b.prize, ref: `Boost prize $${b.prize} ${b.id}` });
    const total = boostResultUsd(b);
    u.history.unshift({ kind: 'boost', label: b.win ? `Boost prize · $${b.prize}` : `Boost · $${b.price}`, date: 'Just now', at: b.endsAt, amount: `+${toBtc(total).toFixed(8)}`, coin: 'BTC', net: 'BTC' });
    notify(u, b.win ? { kind: 'purchase', title: 'Boost finished', body: `You won $${b.prize}. $${total.toFixed(2)} was added to your balance.` } : { kind: 'purchase', title: 'Boost finished', body: `$${b.pay.toFixed(2)} was added to your balance.` });
  }
  foldOld(u);
  return n;
}

// Settled boosts without a prize beyond the newest KEEP_SETTLED are removed from the account, and what they brought (in BTC, as
// boostBtcOf counts it) moves into u.boostPast, so the balance does not change. Winning boosts stay: the winners bar reads them.
function foldOld(u) {
  const old = (u.boosts || []).filter((b) => b.settled && !b.win).sort((a, b) => b.endsAt - a.endsAt).slice(KEEP_SETTLED);
  if (!old.length) return;
  let btc = 0;
  for (const b of old) if (b.rate > 0) btc += boostResultUsd(b) / b.rate;
  u.boostPast = (Number(u.boostPast) || 0) + btc;
  const gone = new Set(old);
  u.boosts = u.boosts.filter((b) => !gone.has(b));
}

// Settles one account's finished boosts. Safe to call twice, or on two servers at once: the account is locked and each boost settles once.
export async function settleBoosts(userId) {
  const pre = await getUser(userId);
  const now = Date.now();
  if (!(pre.boosts || []).some((b) => !b.settled && now >= b.endsAt)) return 0;
  return withUser(userId, (u, c) => (u ? settleIn(c, u) : 0));
}

// Every account with a finished boost still to settle (called by the timer in renew.js). Returns how many boosts were settled.
export async function settleDue(now = Date.now()) {
  // The first condition is the one of the partial index users_boost_open_idx; the second keeps boosts that are still running out.
  const ids = (
    await q(
      `SELECT id FROM users WHERE data->'boosts' @> '[{"settled": false}]'::jsonb
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(data->'boosts') = 'array' THEN data->'boosts' ELSE '[]'::jsonb END) b
                       WHERE b->>'settled' = 'false' AND (b->>'endsAt')::bigint <= $1)`,
      [now],
    )
  ).rows.map((r) => r.id);
  let n = 0;
  for (const id of ids) {
    try {
      n += await withUser(id, (u, c) => (u ? settleIn(c, u, now) : 0));
    } catch (e) {
      console.error(`[boost] ${id} failed:`, e.message);
    }
  }
  return n;
}

// ---- Reading ----

// One boost as the user may see it: the draw result only once the boost has ended, and the shown chance (never the real one).
const publicBoost = (b, now) => ({
  id: b.id,
  ticket: b.t,
  price: b.price,
  th: b.th,
  pay: b.pay,
  prize: b.prize,
  gift: !!b.gift,
  chance: b.shown ?? b.chance,
  startAt: b.startAt,
  endsAt: b.endsAt,
  done: now >= b.endsAt,
  ...(now >= b.endsAt ? { win: !!b.win } : {}),
});

// The landing winners bar: [{ name (masked), prize, at }], empty while tickets are off. Real wins (finished boosts with win = true, newest first)
// come first and sample ones fill the rest (lib/boost.js pickWinners). Only the masked name, the prize and the time leave the server: no id,
// no chance. The demo account and closed accounts (id closed:...) never show. Held for 5 min per server; `nocache` skips that (tests).
// The first WHERE condition is the one of the partial index users_boost_win_idx, so only accounts with a winning boost are read.
const WINNERS_TTL = 300_000;
let winnersCache = { at: 0, list: [] };
export async function recentWinners({ now = Date.now(), rand = Math.random, nocache = false } = {}) {
  if (!boostOn(await boostSettings())) return [];
  if (!nocache && now - winnersCache.at < WINNERS_TTL) return winnersCache.list;
  const rows = (
    await q(
      `SELECT u.id, u.data->>'tgName' AS tg_name, (b->>'prize')::int AS prize, (b->>'endsAt')::bigint AS at
         FROM users u, jsonb_array_elements(CASE WHEN jsonb_typeof(u.data->'boosts') = 'array' THEN u.data->'boosts' ELSE '[]'::jsonb END) b
        WHERE u.data->'boosts' @> '[{"win": true}]'::jsonb
          AND b->>'win' = 'true' AND (b->>'endsAt')::bigint <= $1 AND u.id <> 'demo' AND u.id NOT LIKE 'closed:%'
        ORDER BY at DESC LIMIT $2`,
      [now, WINNERS.count],
    )
  ).rows;
  const real = rows.map((r) => ({ name: maskId(r.id, r.tg_name), prize: Number(r.prize), at: Number(r.at) }));
  const list = pickWinners({ real, mock: mockWinners(now, rand), count: WINNERS.count, rand });
  winnersCache = { at: now, list };
  return list;
}

// What the boost screen needs: whether tickets are on, each ticket with its chance, and the account's running boosts (oldest first)
// and last finished ones (newest first).
export async function getBoosts(userId = 'demo') {
  const cfg = await boostSettings();
  await settleBoosts(userId);
  await claimVipTickets(userId); // monthly VIP tickets, once a month on the first visit
  const u = await getUser(userId);
  const difficulty = cfg.float.on ? (await getLive().catch(() => null))?.difficulty : null;
  const now = Date.now();
  const list = u.boosts || [];
  const running = list.filter((b) => now < b.endsAt).sort((a, b) => a.startAt - b.startAt);
  const finished = list.filter((b) => now >= b.endsAt).sort((a, b) => b.endsAt - a.endsAt).slice(0, 10);
  return {
    enabled: boostOn(cfg),
    hours: BOOST.hours,
    now,
    free: u.freeTickets || 0, // free tickets waiting to be used
    auto: autoPublic(u.autoBoost, cfg),
    tickets: TICKETS.map((t) => ({ id: t.id, price: t.price, th: t.th, pay: t.pay, prize: t.prize, coin: t.coin, max: t.max, chance: floatedShown(cfg, t.id, difficulty), active: activeCount(u, t.id, now) })),
    running: running.map((b) => publicBoost(b, now)),
    finished: finished.map((b) => publicBoost(b, now)),
  };
}

// ---- Admin ----

// Every boost still running on the accounts given, newest first, for the admin screen. `win` is the hidden draw result (only the admin sees it).
export function runningBoosts(list, now = Date.now()) {
  const rows = [];
  for (const u of list) {
    for (const b of u.boosts || []) {
      if (now < b.endsAt) rows.push({ userId: u.id, id: b.id, ticket: b.t, price: b.price, th: b.th, prize: b.prize, gift: !!b.gift, chance: b.chance, win: !!b.win, forced: !!b.forced, startAt: b.startAt, endsAt: b.endsAt });
    }
  }
  return rows.sort((a, b) => b.startAt - a.startAt);
}

// Makes one running boost a winner (a gift from the admin). The draw was fixed at purchase, so this flips it; the prize reaches the balance when
// the boost ends, like any other win. Only a running boost can change, and a boost that already wins is left alone.
export async function forceBoostWin(userId, boostId, now = Date.now()) {
  return withUser(userId, (u) => {
    if (!u) return fail(404, 'Account not found.');
    const b = (u.boosts || []).find((x) => x.id === String(boostId));
    if (!b) return fail(404, 'Boost not found.');
    if (b.settled || now >= b.endsAt) return fail(409, 'This boost has already ended.');
    if (b.win) return fail(409, 'This boost already wins.');
    b.win = true;
    b.forced = true;
    return { ok: true, status: 200 };
  });
}
