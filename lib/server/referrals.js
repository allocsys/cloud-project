// Referral programme: invite codes, who invited whom, editable reward settings and the rewards themselves.
// Storage lives in lib/server/db.js (per-user fields refBy, refAt, refUsed, refRebate, refBonusAt, refRewardAt, ...;
// settings in the shared meta entry "referral"; codes in the codes table so any code is found without scanning users).
//
// Friend (referee): gets a free miner after their first purchase of refereeMinUsd or more.
// Referrer: gets firstPct of that first purchase, plus dailyPct of the friend's daily payouts for dailyDays.
// Everything the referrer earns is capped at capPct of what the friend spends, minus the cost of the free miner.
// Rewards are worked out on read from timestamps, so no daily job is needed.
// Codes: every user has a default code (0% rebate, user.refCode) and can add named codes (user.refCodes) that give
// friends a rebate. A rebate is a share of the referrer's own reward from that friend, paid to the friend. A friend's
// rate is locked at sign-up (user.refRebate) and can only go up later, so it is never taken away.
// user.refUsed is the code a friend signed up with. (It used to share the refCode field with the friend's own code.)
//
// Shape: async functions load what is needed (a "context": the user, their friends and their inviter), the rest is
// pure arithmetic on that context, so a wallet or dashboard read is a handful of queries however many friends exist.
import { randomBytes, randomInt } from 'node:crypto';
import { INVITE_MIN_USD, FREE_INVITES } from '@/lib/rules';
import { BTC_USD, hallFor, customPlan } from '@/lib/data';
import { makeContract } from '@/lib/contracts';
import { usdPerDay, btcOn } from '@/lib/earnings';
import { normalizeGuard } from '@/lib/guard';
import { getMarket } from '@/lib/server/market';
import { getPrices } from '@/lib/server/prices';
import { normalizeBoost, boostOn } from '@/lib/boost';
import { pool, getUser, friendsOf, usersIn, withUser, notify, catalog, takeSerial, metaGet, metaUpdate, metaDelete, claimCode, releaseCode, codeOwner, allUsers } from '@/lib/server/db';

// FREE_INVITES (friends an account with no plan can bring in) and INVITE_MIN_USD (custom power that removes the limit)
// live in lib/rules.js. A plan, or INVITE_MIN_USD of custom power, removes the limit.
export { INVITE_MIN_USD, FREE_INVITES };

// Spent on custom power (older miners without a saved price are priced from the live halls). Gift miners do not count.
export const inviteSpend = (u) => u.contracts.filter((c) => c.plan === 'Custom' && !c.bonus).reduce((s, c) => s + priceOf(c), 0);

// True once the account has bought a plan (or enough custom power): no invite limit.
export const inviteUnlocked = (u) => u.contracts.some((c) => c.plan !== 'Custom' && !c.bonus) || inviteSpend(u) >= INVITE_MIN_USD;

// Friends who signed up with this account's codes, not counting `exceptId`.
const invitedCount = async (c, id, exceptId = '') => Number((await c.query('SELECT count(*) AS n FROM users WHERE ref_by = $1 AND id <> $2', [id, exceptId])).rows[0].n);

export const DEFAULTS = {
  firstPct: 3,
  dailyPct: 1,
  dailyDays: 90,
  capPct: 4,
  refereeTh: 1,
  refereeDays: 30,
  refereeMinUsd: 10,
  monthlyLimit: 20,
  overLimit: 'never', // a friend whose purchase comes when the inviter already has monthlyLimit rewarded friends this month: 'never' or 'later'
  maxRebate: 50,
  maxCodes: 5,
  ticketCap: 5,
  // VIP 1, 2, ... (VIP 0 is the plain numbers above). A user holds the highest level whose minimum spend OR minimum active friends they reach.
  vip: [
    { minSpendUsd: 100, minFriends: 1, firstPct: 4, dailyPct: 1.5, capPct: 6, monthlyLimit: 30, ticketsPerMonth: 1 },
    { minSpendUsd: 500, minFriends: 3, firstPct: 5, dailyPct: 2, capPct: 8, monthlyLimit: 50, ticketsPerMonth: 2 },
    { minSpendUsd: 2000, minFriends: 10, firstPct: 6, dailyPct: 2.5, capPct: 10, monthlyLimit: 80, ticketsPerMonth: 4 },
    { minSpendUsd: 10000, minFriends: 25, firstPct: 8, dailyPct: 3, capPct: 13, monthlyLimit: 120, ticketsPerMonth: 8 },
    { minSpendUsd: 25000, minFriends: 50, firstPct: 10, dailyPct: 4, capPct: 16, monthlyLimit: 200, ticketsPerMonth: 15 },
  ],
};

const LIMITS = {
  firstPct: ['First purchase reward', 0, 10],
  dailyPct: ['Daily payout reward', 0, 5],
  dailyDays: ['Daily reward days', 1, 365, true],
  capPct: ['Cap', 0, 20],
  refereeTh: ['Friend gift power', 0, 100],
  refereeDays: ['Friend gift days', 1, 365, true],
  refereeMinUsd: ['Minimum first purchase', 1, 10000],
  monthlyLimit: ['Rewarded friends per month', 1, 1000, true],
  maxRebate: ['Largest rebate', 0, 100, true],
  maxCodes: ['Codes per user', 1, 20, true],
  ticketCap: ['Free tickets per inviter', 0, 10, true],
};

export const settings = () => ({ ...DEFAULTS, ...(metaGet('referral') || {}) });
const OVER_LIMIT = ['never', 'later'];

// ---- VIP ----
// Levels 1+ come from settings.vip; level 0 is the plain referral numbers. Level = the highest tier whose minimum spend or minimum
// active friends is reached (a minimum of 0 is switched off). It never goes down (u.vipPeak keeps the best level reached).
// A friend's rates are locked when their reward starts (f.refRates), so a later level-up never changes what an old friend pays.
export const VIP_FIELDS = {
  minSpendUsd: ['Minimum spend', 0, 1000000],
  minFriends: ['Minimum active friends', 0, 100000, true],
  firstPct: ['First purchase reward', 0, 20],
  dailyPct: ['Daily payout reward', 0, 10],
  capPct: ['Cap', 0, 40],
  monthlyLimit: ['Rewarded friends per month', 1, 1000, true],
  ticketsPerMonth: ['Free tickets per month', 0, 100, true],
};

function cleanVip(input, cur) {
  if (input === undefined) return { value: cur };
  if (!Array.isArray(input) || input.length < 1 || input.length > 10) return { error: 'VIP levels must be a list of 1 to 10.' };
  const out = [];
  for (const [i, t] of input.entries()) {
    const row = {};
    for (const [k, [label, lo, hi, whole]] of Object.entries(VIP_FIELDS)) {
      const raw = t?.[k];
      const v = raw === undefined || raw === null || String(raw).trim() === '' ? NaN : Number(String(raw).trim().replace(',', '.'));
      if (!Number.isFinite(v) || v < lo || v > hi || (whole && !Number.isInteger(v))) return { error: `VIP ${i + 1}: ${label} must be ${whole ? 'a whole number ' : ''}between ${lo} and ${hi}.` };
      row[k] = v;
    }
    if (!(row.minSpendUsd > 0 || row.minFriends > 0)) return { error: `VIP ${i + 1}: set a minimum spend or a minimum number of friends.` };
    const prev = out[i - 1];
    if (prev && (row.minSpendUsd < prev.minSpendUsd || row.minFriends < prev.minFriends)) return { error: `VIP ${i + 1}: minimums cannot be lower than VIP ${i}.` };
    out.push(row);
  }
  return { value: out };
}

// All levels, VIP 0 first.
export const vipTiers = (S = settings()) => [
  { level: 0, minSpendUsd: 0, minFriends: 0, firstPct: S.firstPct, dailyPct: S.dailyPct, capPct: S.capPct, monthlyLimit: S.monthlyLimit, ticketsPerMonth: 0 },
  ...(S.vip || []).map((t, i) => ({ level: i + 1, ...t })),
];

// What a user spent on real (paid) miners. Gift miners do not count.
export const spendOf = (u) => u.contracts.filter((c) => !c.bonus).reduce((s, c) => s + priceOf(c), 0);

const activeIn = (friends, now = Date.now()) => friends.filter((f) => f.refRewardAt && f.refRewardAt <= now).length;

// Friends whose reward has started (one query, for code that has no friend list loaded).
const activeCount = async (c, id) => Number((await c.query("SELECT count(*) AS n FROM users WHERE ref_by = $1 AND (data->>'refRewardAt')::numeric <= $2", [id, Date.now()])).rows[0].n);

export function vipOf(u, active, S = settings()) {
  const tiers = vipTiers(S);
  const spend = spendOf(u);
  let level = 0;
  for (const t of tiers) if (t.level > 0 && ((t.minSpendUsd > 0 && spend >= t.minSpendUsd) || (t.minFriends > 0 && active >= t.minFriends))) level = t.level;
  level = Math.min(tiers.length - 1, Math.max(level, u.vipPeak || 0));
  return { level, tier: tiers[level], tiers, spend, active };
}

// Keeps the best level reached (a user never drops a level). Call inside the transaction that locked `u`, after a purchase or a
// friend's reward start; `extra` is a friend whose reward just started and is not saved yet.
export async function bumpVip(c, u, extra = 0) {
  const { level } = vipOf(u, (await activeCount(c, u.id)) + extra);
  if (level > (u.vipPeak || 0)) {
    u.vipPeak = level;
    notify(u, { kind: 'referral', title: 'VIP level up', body: `You reached VIP ${level}` });
  }
  return level;
}

// Everything the VIP card needs, from a loaded context.
export function vipViewOf(ctx) {
  const { u, friends, S } = ctx;
  const { level, tier, tiers, spend, active } = vipOf(u, activeIn(friends), S);
  const pick = (t) => ({ level: t.level, first: t.firstPct, daily: t.dailyPct, cap: t.capPct, monthly: t.monthlyLimit, tickets: t.ticketsPerMonth, minSpendUsd: t.minSpendUsd, minFriends: t.minFriends });
  const nx = tiers[level + 1] || null;
  return {
    level,
    spendUsd: +spend.toFixed(2),
    friends: active,
    now: pick(tier),
    next: nx && { ...pick(nx), leftUsd: nx.minSpendUsd > 0 ? +Math.max(0, nx.minSpendUsd - spend).toFixed(2) : null, leftFriends: nx.minFriends > 0 ? Math.max(0, nx.minFriends - active) : null },
    tiers: tiers.map(pick),
  };
}

// Monthly free boost tickets for VIP users: given once a calendar month, on the first visit that month (no daily job). Also saves
// the level the user holds now, so accounts that qualified before VIP existed catch up. Returns how many tickets were given.
export async function claimVipTickets(userId) {
  const month = new Date().toISOString().slice(0, 7);
  const pre = await getUser(userId);
  if (!pre || pre.closedAt) return 0;
  const g = pre.vipTicketsGiven;
  if (g && g.month === month && g.lvl === (pre.vipPeak || 0)) return 0;
  const S = settings();
  const on = boostOn(normalizeBoost(metaGet('boost')));
  if (!on) return 0; // tickets are off: nothing is given and the month is not marked, so turning them on later still gives them
  return withUser(userId, async (u, c) => {
    if (!u) return 0;
    const { level, tier } = vipOf(u, await activeCount(c, u.id), S);
    u.vipPeak = Math.max(u.vipPeak || 0, level);
    const had = u.vipTicketsGiven?.month === month ? u.vipTicketsGiven.n : 0;
    const give = on ? Math.max(0, tier.ticketsPerMonth - had) : 0;
    u.vipTicketsGiven = { month, n: had + give, lvl: u.vipPeak };
    if (give > 0) {
      u.freeTickets = (u.freeTickets || 0) + give;
      notify(u, { kind: 'referral', title: 'VIP tickets', body: `You got ${give} free boost ticket${give > 1 ? 's' : ''}` });
    }
    return give;
  });
}

// True while free invite tickets are given: Boost tickets are on and the admin cap is above 0.
export const ticketsOn = (S = settings()) => boostOn(normalizeBoost(metaGet('boost'))) && S.ticketCap > 0;

export async function saveSettings(input) {
  // Read, check and write under one lock, so two admins saving at once cannot overwrite each other.
  return metaUpdate('referral', (stored) => {
    const next = {};
    const cur = { ...DEFAULTS, ...(stored || {}) };
    for (const [k, [label, lo, hi, whole]] of Object.entries(LIMITS)) {
      const v = Number(String(input?.[k] ?? cur[k]).trim().replace(',', '.'));
      if (!Number.isFinite(v) || v < lo || v > hi || (whole && !Number.isInteger(v))) {
        return { result: { ok: false, status: 422, error: `${label} must be ${whole ? 'a whole number ' : ''}between ${lo} and ${hi}.` } };
      }
      next[k] = v;
    }
    const over = String(input?.overLimit ?? cur.overLimit).trim();
    if (!OVER_LIMIT.includes(over)) return { result: { ok: false, status: 422, error: 'Friends over the monthly limit must be "never" or "later".' } };
    next.overLimit = over;
    const vip = cleanVip(input?.vip, cur.vip);
    if (vip.error) return { result: { ok: false, status: 422, error: vip.error } };
    next.vip = vip.value;
    return { value: next, result: { ok: true, status: 200 } };
  });
}

export async function resetSettings() {
  await metaDelete('referral');
  return { ok: true, status: 200 };
}

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// Which user and rebate a code belongs to. The default code gives no rebate. `exceptId` cannot use their own code.
export async function resolveCode(code, exceptId) {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return null;
  const ownerId = await codeOwner(c);
  if (!ownerId || ownerId === exceptId) return null;
  const owner = await getUser(ownerId);
  if (owner.closedAt) return null;
  if (owner.refCode && owner.refCode.toUpperCase() === c) return { user: owner, code: owner.refCode, name: 'Default', rebate: 0 };
  const x = (owner.refCodes || []).find((k) => k.code.toUpperCase() === c);
  if (x) return { user: owner, code: x.code, name: x.name, rebate: x.rebate };
  return null;
}

// Reserves a fresh, unused code for a user (inside the caller's transaction) and returns it.
export async function newCode(c, userId) {
  for (let i = 0; i < 20; i += 1) {
    const code = `VTX-${Array.from({ length: 4 }, () => ALPHA[randomInt(ALPHA.length)]).join('')}`;
    if (await claimCode(c, code, userId)) return code;
  }
  throw new Error('Could not find a free invite code.');
}

// A user's default code. Every account gets one when it is created (assignCode), the demo user keeps the code the app
// always showed.
export const codeOf = (u) => u.refCode || null;

// Gives a freshly created account its default code. Call inside the transaction that created it, after the insert.
export async function assignCode(c, u) {
  u.refCode = await newCode(c, u.id);
  return u.refCode;
}

export function mask(id) {
  const s = String(id);
  if (s.startsWith('closed:')) return 'Closed account';
  if (s.startsWith('tg:')) return `Telegram ***${s.slice(-3)}`;
  const at = s.indexOf('@');
  return at > 0 ? `${s[0]}***${s.slice(at)}` : `${s[0] || '?'}***`;
}

// What a purchase cost. Older miners without a saved price are priced from the live catalogue.
export function priceOf(c) {
  if (c.bonus) return 0;
  if (Number.isFinite(c.price)) return c.price;
  if (c.plan === 'Custom') return customPlan(c.th, c.days, catalog().halls).price;
  return 0;
}

// Links a new account (not saved yet, or locked by the caller) to the person who invited them. Called at sign-up with
// the code they entered. Changes the friend document in memory and notifies the inviter inside the same transaction;
// the caller saves the friend. `net` is the sign-up network key (auth.js netKeyOf, empty when unknown): free tickets need one, so nothing
// is given for an admin link or an address that could not be read.
export async function applyLink(c, f, code, net = '') {
  if (f.refBy) return { ok: false, status: 409, error: 'Already linked to an inviter.' };
  const hit = await resolveCode(code, f.id);
  if (!hit) return { ok: false, status: 404, error: 'Invite code not found.' };
  const invId = hit.user.id;
  // Free tickets: a sign-up with a code gives the friend and the inviter one free boost ticket each, while tickets are on and the inviter has
  // fewer than ticketCap (inviter.refTickets). No purchase is needed. The BTC price is read now, before any lock is taken.
  // Only one pair of tickets per network: none when the friend signs up from the inviter's own network, or from a network where an
  // account already got a free ticket (f.netKey, f.ticketGot), so fake sign-ups from one place cannot farm tickets.
  const S = settings();
  const cfg = normalizeBoost(metaGet('boost'));
  const giftsOn = boostOn(cfg) && S.ticketCap > 0;
  // The inviter is locked now, so the code is checked again: its owner may have just deleted it or raised its rebate.
  const live = await usersIn(c, [invId], async (map) => {
    const inv = map.get(invId);
    if (!inv) return null;
    const same = (x) => String(x || '').toUpperCase() === hit.code.toUpperCase();
    const named = (inv.refCodes || []).find((k) => same(k.code));
    if (!same(inv.refCode) && !named) return null;
    // Without a plan the inviter has a limited number of invites. The row is locked, so two sign-ups cannot both take the last one.
    if (!inviteUnlocked(inv) && (await invitedCount(c, invId, f.id)) >= FREE_INVITES) return { full: true };
    let ticket = false;
    const newNet = !!net && inv.netKey !== net && !(await c.query("SELECT 1 FROM users WHERE data->>'netKey' = $1 AND data->>'ticketGot' = 'true' AND id <> $2 LIMIT 1", [net, f.id])).rowCount;
    if (giftsOn && newNet && (inv.refTickets || 0) < S.ticketCap) {
      inv.refTickets = (inv.refTickets || 0) + 1;
      inv.freeTickets = (inv.freeTickets || 0) + 1; // held until the user uses it (lib/server/boost.js buyBoost with free: true)
      ticket = true;
    }
    if (ticket) notify(inv, { kind: 'referral', title: 'Free ticket', body: 'Your friend joined. You got a free boost ticket', code: 'invTicket' });
    else notify(inv, { kind: 'referral', title: 'A friend joined', body: `${mask(f.id)} signed up with your code`, code: 'friend', vars: { id: mask(f.id) } });
    return { rebate: named ? named.rebate : 0, ticket };
  });
  if (!live) return { ok: false, status: 404, error: 'Invite code not found.' };
  if (live.full) return { ok: false, status: 409, error: 'This invite code has reached its limit.' };
  f.refBy = invId;
  f.refAt = Date.now();
  f.refUsed = hit.code;
  f.refRebate = live.rebate;
  if (live.ticket) {
    f.freeTickets = (f.freeTickets || 0) + 1;
    f.ticketGot = true;
    (f.notifications ||= []);
    notify(f, { kind: 'referral', title: 'Welcome gift', body: 'You got a free boost ticket', code: 'giftTicket' });
  }
  return { ok: true, status: 200, inviter: invId };
}

const DAY = 86400000;
const utcDay = (t) => Math.floor(t / DAY) * DAY;

// Reward earned so far from one friend, in USD. `first` is the share from the first purchase, `share` the daily part,
// and `lastAt` when the latest of those daily amounts landed. `market` (see lib/earnings.js) makes the daily part follow
// what the friend's miners really paid each day; without it the static dailyUsd is used.
function friendReward(f, S, now = Date.now(), market = null) {
  const real = f.contracts.filter((c) => !c.bonus);
  const spend = real.reduce((s, c) => s + priceOf(c), 0);
  // A friend held back by the monthly limit has a reward start in a later month: nothing is earned before it.
  if (!f.refRewardAt || f.refRewardAt > now) return { spend, usd: 0, first: 0, share: 0, btc: 0, firstBtc: 0, shareBtc: 0, lastAt: 0 };
  // Each amount is turned into BTC at the price of the day it was earned (the saved market price of a finished day, the live
  // price for today), the same way mining payouts are, so a finished day never moves when the price does.
  const price = (t) => btcOn(market, utcDay(t), utcDay(now), BTC_USD);
  const R = f.refRates || S; // rates locked when this friend's reward started (VIP); older friends use the plain numbers
  const first = ((f.refFirstUsd || 0) * R.firstPct) / 100;
  const firstBtcRaw = first / price(f.refRewardAt);
  const windowEnd = f.refRewardAt + S.dailyDays * DAY;
  let payouts = 0;
  let payoutsBtc = 0;
  let lastAt = f.refRewardAt;
  for (const c of real) {
    const from = Math.max(c.startedAt ?? f.refRewardAt, f.refRewardAt);
    const to = Math.min(now, windowEnd, from + c.days * DAY);
    const days = Math.max(0, Math.floor((to - from) / DAY));
    if (market) {
      for (let k = 0; k < days; k += 1) {
        const u = usdPerDay(c, from + k * DAY, market, now);
        payouts += u;
        payoutsBtc += u / price(from + k * DAY);
      }
    } else {
      payouts += c.dailyUsd * days;
      payoutsBtc += (c.dailyUsd * days) / BTC_USD;
    }
    if (days > 0) lastAt = Math.max(lastAt, from + days * DAY);
  }
  const cap = Math.max(0, (R.capPct / 100) * spend - (f.refBonusUsd || 0));
  const shareGross = (payouts * R.dailyPct) / 100;
  const usd = Math.min(first + shareGross, cap);
  const firstPart = Math.min(first, usd);
  const share = usd - firstPart;
  // The cap is in USD, so each part keeps its own average BTC price.
  const firstBtc = first > 0 ? (firstBtcRaw * firstPart) / first : 0;
  const shareBtc = shareGross > 0 ? (((payoutsBtc * R.dailyPct) / 100) * share) / shareGross : 0;
  return { spend, usd, first: firstPart, share, btc: firstBtc + shareBtc, firstBtc, shareBtc, lastAt };
}

const btc = (amount) => amount.toFixed(8); // a BTC amount as text
const dateLabel = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

// A friend's rebate rate (%): what the code gave at sign-up, or more if the owner raised it since.
function rateOf(f, inviter) {
  const now = (inviter?.refCodes || []).find((k) => k.code === f.refUsed)?.rebate || 0;
  return Math.max(f.refRebate || 0, now);
}

// ---- Context: everything the numbers below need about one user ----

// For a user document you already hold (for example a locked one inside a transaction).
export async function refCtxFor(u, c = pool()) {
  const [friends, inviter, market] = await Promise.all([friendsOf(u.id, c), u.refBy ? getUser(u.refBy, c) : null, getMarket(c)]);
  return { id: u.id, u, friends, inviter, S: settings(), market };
}

export async function getRefCtx(userId, c = pool()) {
  return refCtxFor(await getUser(userId, c), c);
}

// A context is short-lived and its numbers do not change, so the summary is worked out once per context, however many
// of the helpers below ask for it.
const summaries = new WeakMap();

// A referrer's friends and earnings. Earnings are what is left after each friend's rebate.
export function summaryOf(ctx) {
  let s = summaries.get(ctx);
  if (!s) {
    s = buildSummary(ctx);
    summaries.set(ctx, s);
  }
  return s;
}

function buildSummary(ctx) {
  const { u, friends, S } = ctx;
  let total = 0;
  let totalBtc = 0;
  const byCode = new Map();
  const rows = [...friends]
    .sort((a, b) => (b.refAt || 0) - (a.refAt || 0))
    .map((f) => {
      const r = friendReward(f, S, Date.now(), ctx.market);
      const rate = rateOf(f, u);
      const net = (r.usd * (100 - rate)) / 100;
      const netBtc = (r.btc * (100 - rate)) / 100;
      total += net;
      totalBtc += netBtc;
      const code = f.refUsed || codeOf(u);
      const g = byCode.get(code) || { friends: 0, usd: 0, btc: 0 };
      g.friends += 1;
      g.usd += net;
      g.btc += netBtc;
      byCode.set(code, g);
      return { id: f.id, who: mask(f.id), joined: dateLabel(f.refAt || Date.now()), status: f.refRewardAt && f.refRewardAt <= Date.now() ? 'active' : 'pending', earned: `+${btc(netBtc)}`, code, rebate: rate };
    });
  return { friends: rows, earnedUsd: total, earnedBtc: btc(totalBtc), earnedBtcNum: totalBtc, byCode };
}

// What this user receives as a friend, from their inviter's rebate, in USD.
export function rebateUsdOf(ctx) {
  const f = ctx.u;
  if (!f.refBy || !f.refRewardAt) return 0;
  return (friendReward(f, ctx.S, Date.now(), ctx.market).usd * rateOf(f, ctx.inviter)) / 100;
}

// The same in BTC, at the price of the days it was earned.
export function rebateBtcOf(ctx) {
  const f = ctx.u;
  if (!f.refBy || !f.refRewardAt) return 0;
  return (friendReward(f, ctx.S, Date.now(), ctx.market).btc * rateOf(f, ctx.inviter)) / 100;
}

// The rebate this user gets as a friend, or null when their code had none.
export function myRebateOf(ctx) {
  const pct = ctx.u.refBy ? rateOf(ctx.u, ctx.inviter) : 0;
  return pct > 0 ? { pct, btc: btc(rebateBtcOf(ctx)) } : null;
}

// Added to the wallet balance: earnings as a referrer plus the rebate as a friend.
export const rewardBtcOf = (ctx) => summaryOf(ctx).earnedBtcNum + rebateBtcOf(ctx);

// Wallet activity for invite income: per friend one row for the first-purchase reward and one for the daily share
// (both after the friend's rebate), plus one row for the rebate this user gets as a friend. Worked out on read, like the balance.
export function historyOfCtx(ctx, now = Date.now()) {
  const { S } = ctx;
  const out = [];
  const add = (label, btcAmount, at) => {
    const amount = btc(btcAmount);
    if (!(parseFloat(amount) > 0)) return;
    out.push({ kind: 'referral', label, at, amount: `+${amount}`, coin: 'BTC', net: 'BTC' });
  };
  for (const f of ctx.friends) {
    if (!f.refRewardAt) continue;
    const r = friendReward(f, S, now, ctx.market);
    const keep = (100 - rateOf(f, ctx.u)) / 100;
    add(`Invite bonus · ${mask(f.id)}`, r.firstBtc * keep, f.refRewardAt);
    add(`Invite payouts · ${mask(f.id)}`, r.shareBtc * keep, r.lastAt);
  }
  const me = ctx.u;
  if (me.refBy && me.refRewardAt) {
    const rate = rateOf(me, ctx.inviter);
    if (rate > 0) {
      const r = friendReward(me, S, now, ctx.market);
      add(`Invite rebate · ${rate}%`, (r.btc * rate) / 100, r.lastAt);
    }
  }
  return out;
}

// Codes of one user with their friends and earnings. The default code is always first.
export function codesOfCtx(ctx) {
  const { byCode } = summaryOf(ctx);
  const row = (code, name, rebate, isDefault) => {
    const g = byCode.get(code) || { friends: 0, usd: 0, btc: 0 };
    return { code, name, rebate, default: isDefault, friends: g.friends, earnedBtc: btc(g.btc) };
  };
  return [row(codeOf(ctx.u), 'Default', 0, true), ...(ctx.u.refCodes || []).map((k) => row(k.code, k.name, k.rebate, false))];
}

// ---- Managing codes ----

const bad = (error) => ({ ok: false, status: 422, error });

function cleanRebate(v, S) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > S.maxRebate) return null;
  return n;
}

export async function createCode(userId, input) {
  const S = settings();
  const name = String(input?.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 20);
  if (!name) return bad('Give the code a name.');
  const rebate = cleanRebate(input?.rebate, S);
  if (rebate === null) return bad(`Rebate must be a whole number from 0 to ${S.maxRebate}.`);
  return withUser(userId, async (u, c) => {
    if (!u) return { ok: false, status: 404, error: 'Account not found.' };
    u.refCodes ||= [];
    if (u.refCodes.length + 1 >= S.maxCodes) return bad(`You can have up to ${S.maxCodes} codes.`);
    if (u.refCodes.some((k) => k.name.toLowerCase() === name.toLowerCase())) return bad('You already have a code with this name.');
    u.refCodes.push({ code: await newCode(c, userId), name, rebate, at: Date.now() });
    return { ok: true, status: 200 };
  });
}

// A rebate can only be raised, never lowered, so friends keep what they signed up for.
export async function raiseCode(userId, code, rebateIn) {
  const S = settings();
  return withUser(userId, (u) => {
    const k = (u?.refCodes || []).find((x) => x.code === String(code));
    if (!k) return { ok: false, status: 404, error: 'Code not found.' };
    const rebate = cleanRebate(rebateIn, S);
    if (rebate === null) return bad(`Rebate must be a whole number from 0 to ${S.maxRebate}.`);
    if (rebate < k.rebate) return bad('A rebate can only be raised, not lowered.');
    k.rebate = rebate;
    return { ok: true, status: 200 };
  });
}

// A code with friends cannot be removed, because their rebate depends on it.
export async function deleteCode(userId, code) {
  return withUser(userId, async (u, c) => {
    const i = (u?.refCodes || []).findIndex((x) => x.code === String(code));
    if (i < 0) return { ok: false, status: 404, error: 'Code not found.' };
    const used = await c.query("SELECT 1 FROM users WHERE ref_by = $1 AND data->>'refUsed' = $2 LIMIT 1", [userId, u.refCodes[i].code]);
    if (used.rowCount) return bad('This code has friends, so it cannot be removed.');
    await releaseCode(c, u.refCodes[i].code);
    u.refCodes.splice(i, 1);
    return { ok: true, status: 200 };
  });
}

// Shown on the sign-up screen before the friend joins.
export async function publicCode(code) {
  const hit = await resolveCode(code);
  if (!hit) return { valid: false, rebate: 0 };
  if (!inviteUnlocked(hit.user) && (await invitedCount(pool(), hit.user.id)) >= FREE_INVITES) return { valid: false, rebate: 0 };
  return { valid: true, rebate: hit.rebate };
}

export function rulesText(S = settings()) {
  return [
    `You can invite up to ${FREE_INVITES} friends without a plan. Buy any plan, or at least $${INVITE_MIN_USD} of custom power, to invite without a limit.`,
    'Share your code or link. Your friend enters it when signing up.',
    ...(S.refereeTh > 0 ? [`Your friend gets ${S.refereeTh} TH/s free for ${S.refereeDays} days with a first purchase of $${S.refereeMinUsd} or more.`] : []),
    ...(ticketsOn(S) ? [`You and your friend each get a free boost ticket when they join (up to ${S.ticketCap} per person).`] : []),
    `You earn ${S.firstPct}% of their first purchase, plus ${S.dailyPct}% of their daily payouts for ${S.dailyDays} days, paid in BTC.`,
    `Rewards start once their first purchase is active and are capped at ${S.capPct}% of what they spend.`,
    ...((S.vip || []).length ? [`VIP 1 to ${S.vip.length}: spend more or bring more active friends to earn higher rates, a higher monthly limit and free boost tickets. A level never goes down, and each friend keeps the rates from when their reward started.`] : []),
    `You can create named codes that pass part of your reward to your friends as a rebate (up to ${S.maxRebate}%). A friend keeps the rebate they signed up with.`,
    `Up to ${S.monthlyLimit} rewarded friends per month. Self-referrals and duplicate accounts are not rewarded.`,
  ];
}

// Called inside the purchase transaction, with the buyer `f` and their inviter `inv` both locked by the caller, when
// a purchase goes live. Gives the friend their gift and starts the referrer's rewards. Returns the gift miner, or null
// when nothing applied.
export async function onPurchase(c, f, inv, plan) {
  const S = settings();
  if (!f.refBy || f.refBonusAt || !(plan.price >= S.refereeMinUsd) || !inv) return null;
  const now = Date.now();
  f.refBonusAt = now;
  f.refFirstUsd = plan.price;
  // The inviter's VIP level now sets this friend's rates for good, and the monthly limit used below.
  const T = vipOf(inv, await activeCount(c, inv.id), S).tier;
  f.refRates = { firstPct: T.firstPct, dailyPct: T.dailyPct, capPct: T.capPct, vip: T.level };

  let bonus = null;
  if (S.refereeTh > 0) {
    const th = S.refereeTh;
    const hall = hallFor(th);
    bonus = {
      ...makeContract({ name: 'Welcome', th, hall, days: S.refereeDays, daily: `$${(th * catalog().halls[hall].net).toFixed(2)}`, price: 0 }, await takeSerial(c)),
      bonus: true,
      pauseRule: normalizeGuard(metaGet('guard')).mode, // what a paused day does to its term, as the admin has it now
    };
    f.contracts.push(bonus);
    f.refBonusUsd = bonus.dailyUsd * bonus.days;
    notify(f, { kind: 'referral', title: 'Welcome gift', body: `${th} TH/s free for ${S.refereeDays} days (${bonus.serial})` });
  }

  // The inviter row is locked, so two friends buying at once are counted one after the other.
  // A friend counts toward the month their refRewardAt falls in, so one held for a later month counts there.
  const d = new Date(now);
  const rewardedIn = async (k) =>
    Number(
      (
        await c.query(
          "SELECT count(*) AS n FROM users WHERE ref_by = $1 AND id <> $2 AND (data->>'refRewardAt')::numeric >= $3 AND (data->>'refRewardAt')::numeric < $4",
          [inv.id, f.id, new Date(d.getFullYear(), d.getMonth() + k, 1).getTime(), new Date(d.getFullYear(), d.getMonth() + k + 1, 1).getTime()],
        )
      ).rows[0].n,
    );
  if ((await rewardedIn(0)) < T.monthlyLimit) {
    f.refRewardAt = now;
    const first = friendReward(f, S, now).usd;
    notify(inv, { kind: 'referral', title: 'Friend started mining', body: `${mask(f.id)} bought a plan. You earned $${first.toFixed(2)} so far` });
  } else if (S.overLimit === 'later') {
    // The first month with room (at most two years ahead). Rewards for this friend start on its first day; none is paid before it.
    for (let k = 1; k <= 24; k += 1) {
      if ((await rewardedIn(k)) >= T.monthlyLimit) continue;
      f.refRewardAt = new Date(d.getFullYear(), d.getMonth() + k, 1).getTime();
      notify(inv, { kind: 'referral', title: 'Friend started mining', body: `${mask(f.id)} bought a plan. This month's ${T.monthlyLimit} rewarded friends are taken, so their reward starts on ${dateLabel(f.refRewardAt)}` });
      break;
    }
  }
  await bumpVip(c, inv, f.refRewardAt && f.refRewardAt <= now ? 1 : 0); // this friend may lift the inviter to a new level
  return bonus;
}

// Everything the admin Referrals tab shows. The overview passes the accounts it already loaded, so they are read once.
export async function adminView(list = null) {
  const S = settings();
  const all = list || (await allUsers());
  const market = await getMarket();
  const byId = new Map(all.map((u) => [u.id, u]));
  return {
    settings: S,
    codes: all.map((u) => ({ id: u.id, code: codeOf(u) })),
    tickets: all.filter((u) => u.refTickets > 0).map((u) => ({ id: u.id, n: u.refTickets })).sort((a, b) => b.n - a.n),
    links: all
      .filter((f) => f.refBy)
      .map((f) => {
        const r = friendReward(f, S, Date.now(), market);
        return { friend: f.id, inviter: f.refBy, gift: !!f.refBonusAt, ticket: !!f.ticketGot, rewarded: !!f.refRewardAt && f.refRewardAt <= Date.now(), startsAt: f.refRewardAt > Date.now() ? f.refRewardAt : null, spendUsd: Math.round(r.spend * 100) / 100, rewardUsd: Math.round(r.usd * 100) / 100, rebate: rateOf(f, byId.get(f.refBy)) };
      }),
  };
}
