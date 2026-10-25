// Boost tickets: settings, buying a ticket, and settling finished boosts. Rules and maths: lib/boost.js. Storage: lib/server/db.js.
// Settings live in the meta entry "boost" { enabled, chance: { t1, t10, t100 }, shown: { t1, t10, t100 } } (percent; shown null = same as chance). `chance` is the real
// chance (draw and margin); users only ever get the shown one. A change reaches every server within a few seconds.
// A ticket is paid from the balance, through the same steps as a plan (account locked, balance checked, spend written to the ledger).
// The draw is made at purchase with a secure random number and stored on the boost, but nothing shows it until the boost ends.
// When a boost ends its pay and prize are already part of the balance (lib/boost.js boostBtcOf); settling only writes what the user sees
// (activity, notification) and the ledger rows, once per boost. It runs when the user opens the boosts and from the timer in renew.js.
import { randomBytes, randomInt } from 'node:crypto';
import { BOOST, TICKETS, ticketOf, normalizeBoost, boostOn, marginOf, activeCount, drawWins, boostResultUsd, shownOf, WINNERS, maskId, mockWinners, pickWinners, KEEP_SETTLED } from '@/lib/boost';
import { warm, metaGet, metaUpdate, getUser, withUser, withIdem, idemGet, ledger, notify, q } from '@/lib/server/db';
import { getPrices } from '@/lib/server/prices';
import { availableIn, TOLERANCE } from '@/lib/server/wallet';
import { lockedBtc } from '@/lib/deposit-hold';
import { getMarket } from '@/lib/server/market';

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
  return metaUpdate('boost', (cur) => {
    const base = normalizeBoost(cur);
    const next = normalizeBoost({ ...base, ...patch, chance: { ...base.chance, ...chance }, shown: { ...base.shown, ...shown } });
    const losing = TICKETS.filter((t) => chance[t.id] !== undefined && marginOf(t, next.chance[t.id]) < 0);
    if (losing.length && input?.confirm !== true) {
      return { result: fail(409, `The $${losing.map((t) => t.price).join(', $')} ticket would lose money at this chance. Confirm to save it anyway.`, { needConfirm: true }) };
    }
    return { value: next, result: { ok: true, status: 200, settings: next } };
  });
}

// ---- Buying ----

// Buys one ticket from the balance and starts its boost. Same Idempotency-Key twice returns the first result instead of buying twice.
export async function buyBoost(input, { userId = 'demo', key } = {}) {
  const idemKey = key ? `boost:${userId}:${key}` : null;
  const prior = await idemGet(idemKey);
  if (prior) return prior;
  const cfg = await boostSettings();
  if (!boostOn(cfg)) return fail(409, 'Boost tickets are not available right now.');
  const t = ticketOf(String(input?.ticket ?? ''));
  if (!t) return fail(400, 'Unknown ticket.');
  const { prices } = await getPrices();
  await getMarket(); // warms the market cache now, so nothing slow happens while the account is locked
  const rate = prices.btc;
  if (!(rate > 0)) return fail(503, 'No BTC price is available right now. Try again in a moment.');
  const cost = Math.ceil((t.price / rate) * 1e8) / 1e8;
  const chance = cfg.chance[t.id]; // the real chance: read now, fixed on the boost below
  const shown = shownOf(cfg, t.id); // what the user was told, fixed on the boost too

  return withUser(userId, (u, c) =>
    withIdem(c, idemKey, async () => {
      if (!u) return fail(404, 'Account not found.');
      const now = Date.now();
      if (activeCount(u, t.id, now) >= t.max) return fail(409, `You can have up to ${t.max} of this boost running at once.`);
      // A deposit still inside its hold (no plan yet) cannot be turned into a ticket: the boost pay would come back unlocked.
      if (cost > (await availableIn(c, u)) - lockedBtc(u, now) + TOLERANCE) return fail(409, 'Not enough balance for this ticket.');
      const boost = {
        id: `bst_${randomBytes(6).toString('base64url')}`,
        t: t.id,
        price: t.price,
        th: t.th,
        pay: t.pay,
        prize: t.prize,
        chance,
        shown,
        win: drawWins(chance, randomInt(1_000_000)),
        rate,
        startAt: now,
        endsAt: now + BOOST.hours * 3600_000,
        settled: false,
      };
      (u.boosts ||= []).push(boost);
      u.spent = (u.spent || 0) + cost;
      u.history.unshift({ kind: 'boost-buy', label: `Boost ticket · $${t.price}`, date: 'Just now', at: now, amount: `-$${t.price}`, net: 'Balance' });
      notify(u, { kind: 'purchase', title: 'Boost started', body: `${t.th.toLocaleString('en-US')} TH/s for ${BOOST.hours} hours.`, code: 'boost', vars: { th: t.th.toLocaleString('en-US'), h: BOOST.hours } });
      await ledger(c, userId, 'spend', { btc: cost, usd: t.price, ref: `Boost ticket $${t.price} ${boost.id}` });
      return { ok: true, status: 200, boost: publicBoost(boost, now), spentBtc: cost };
    }),
  );
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
  chance: b.shown ?? b.chance,
  startAt: b.startAt,
  endsAt: b.endsAt,
  done: now >= b.endsAt,
  ...(now >= b.endsAt ? { win: !!b.win } : {}),
});

// The landing winners bar: [{ name (masked), prize, at }], empty while tickets are off. Real wins (finished boosts with win = true, newest first)
// come first and sample ones fill the rest (lib/boost.js pickWinners). Only the masked name, the prize and the time leave the server: no id,
// no chance. The demo account and closed accounts (id closed:...) never show. Held for 30 s per server; `nocache` skips that (tests).
const WINNERS_TTL = 30_000;
let winnersCache = { at: 0, list: [] };
export async function recentWinners({ now = Date.now(), rand = Math.random, nocache = false } = {}) {
  if (!boostOn(await boostSettings())) return [];
  if (!nocache && now - winnersCache.at < WINNERS_TTL) return winnersCache.list;
  const rows = (
    await q(
      `SELECT u.id, u.data->>'tgName' AS tg_name, (b->>'prize')::int AS prize, (b->>'endsAt')::bigint AS at
         FROM users u, jsonb_array_elements(CASE WHEN jsonb_typeof(u.data->'boosts') = 'array' THEN u.data->'boosts' ELSE '[]'::jsonb END) b
        WHERE b->>'win' = 'true' AND (b->>'endsAt')::bigint <= $1 AND u.id <> 'demo' AND u.id NOT LIKE 'closed:%'
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
  const u = await getUser(userId);
  const now = Date.now();
  const list = u.boosts || [];
  const running = list.filter((b) => now < b.endsAt).sort((a, b) => a.startAt - b.startAt);
  const finished = list.filter((b) => now >= b.endsAt).sort((a, b) => b.endsAt - a.endsAt).slice(0, 10);
  return {
    enabled: boostOn(cfg),
    hours: BOOST.hours,
    now,
    tickets: TICKETS.map((t) => ({ id: t.id, price: t.price, th: t.th, pay: t.pay, prize: t.prize, coin: t.coin, max: t.max, chance: shownOf(cfg, t.id), active: activeCount(u, t.id, now) })),
    running: running.map((b) => publicBoost(b, now)),
    finished: finished.map((b) => publicBoost(b, now)),
  };
}
