// Referral programme: invite codes, who invited whom, editable reward settings and the rewards themselves.
// Storage lives in lib/server/db.js (per-user fields refBy, refAt, refBonusAt, refRewardAt, ...; settings in store.refSettings).
//
// Friend (referee): gets a free miner after their first purchase of refereeMinUsd or more.
// Referrer: gets firstPct of that first purchase, plus dailyPct of the friend's daily payouts for dailyDays.
// Everything the referrer earns is capped at capPct of what the friend spends, minus the cost of the free miner.
// Rewards are worked out on read from timestamps, so no daily job is needed.
// Codes: every user has a default code (0% rebate) and can add named codes (u.refCodes) that give friends a rebate.
// A rebate is a share of the referrer's own reward from that friend, paid to the friend. A friend's rate is locked at
// sign-up and can only go up later, so it is never taken away.
import { randomInt } from 'node:crypto';
import { BTC_USD, hallFor, customPlan } from '@/lib/data';
import { makeContract } from '@/lib/contracts';
import { store, userOf, notify, catalog, takeSerial } from '@/lib/server/db';

export const INVITE_MIN_USD = 10;

export const DEFAULTS = {
  firstPct: 3,
  dailyPct: 1,
  dailyDays: 90,
  capPct: 4,
  refereeTh: 1,
  refereeDays: 30,
  refereeMinUsd: 10,
  monthlyLimit: 20,
  maxRebate: 50,
  maxCodes: 5,
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
};

export const settings = () => ({ ...DEFAULTS, ...(store.refSettings || {}) });

export function saveSettings(input) {
  const next = {};
  const cur = settings();
  for (const [k, [label, lo, hi, whole]] of Object.entries(LIMITS)) {
    const v = Number(String(input?.[k] ?? cur[k]).trim().replace(',', '.'));
    if (!Number.isFinite(v) || v < lo || v > hi || (whole && !Number.isInteger(v))) {
      return { ok: false, status: 422, error: `${label} must be ${whole ? 'a whole number ' : ''}between ${lo} and ${hi}.` };
    }
    next[k] = v;
  }
  store.refSettings = next;
  return { ok: true, status: 200 };
}

export function resetSettings() {
  store.refSettings = null;
  return { ok: true, status: 200 };
}

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// Reads a user's default code without creating one, so a lookup never has side effects or recursion.
const peekCode = (u) => u.refCode || (u.id === 'demo' ? 'OPUS-7K2M' : null);

// Which user and rebate a code belongs to. The default code gives no rebate.
export function resolveCode(code, exceptId) {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return null;
  for (const u of store.users.values()) {
    if (u.id === exceptId) continue;
    const d = peekCode(u);
    if (d && d.toUpperCase() === c) return { user: u, code: d, name: 'Default', rebate: 0 };
    const x = (u.refCodes || []).find((k) => k.code.toUpperCase() === c);
    if (x) return { user: u, code: x.code, name: x.name, rebate: x.rebate };
  }
  return null;
}

export const findByCode = (code, exceptId) => resolveCode(code, exceptId)?.user || null;

const newCode = () => {
  let c;
  do {
    c = `OPUS-${Array.from({ length: 4 }, () => ALPHA[randomInt(ALPHA.length)]).join('')}`;
  } while (resolveCode(c));
  return c;
};

// Every user gets one stable default code. The demo user keeps the code the app always showed.
export function codeOf(u) {
  if (!u.refCode) u.refCode = u.id === 'demo' ? 'OPUS-7K2M' : newCode();
  return u.refCode;
}

export function mask(id) {
  const s = String(id);
  if (s.startsWith('tg:')) return `Telegram ***${s.slice(-3)}`;
  const at = s.indexOf('@');
  return at > 0 ? `${s[0]}***${s.slice(at)}` : `${s[0] || '?'}***`;
}

// What a purchase cost. Older miners without a saved price are priced from the live catalogue.
export function priceOf(c) {
  if (c.bonus) return 0;
  if (Number.isFinite(c.price)) return c.price;
  const cat = catalog();
  if (c.plan === 'Custom') return customPlan(c.th, c.days, cat.halls).price;
  return cat.plans.find((p) => p.name === c.plan)?.price ?? 0;
}

// Link a user to the person who invited them. Called at signup with the code they entered.
export function link(friendId, code) {
  const f = userOf(friendId);
  if (f.refBy) return { ok: false, status: 409, error: 'Already linked to an inviter.' };
  const hit = resolveCode(code, friendId);
  if (!hit) return { ok: false, status: 404, error: 'Invite code not found.' };
  const inv = hit.user;
  f.refBy = inv.id;
  f.refAt = Date.now();
  f.refCode = hit.code;
  f.refRebate = hit.rebate;
  notify(inv, { kind: 'referral', title: 'A friend joined', body: `${mask(friendId)} signed up with your code` });
  return { ok: true, status: 200, inviter: inv.id };
}

const DAY = 86400000;

// Reward earned so far from one friend, in USD. `first` is the share from the first purchase, `share` the daily part,
// and `lastAt` when the latest of those daily amounts landed.
function friendReward(f, S, now = Date.now()) {
  const real = f.contracts.filter((c) => !c.bonus);
  const spend = real.reduce((s, c) => s + priceOf(c), 0);
  if (!f.refRewardAt) return { spend, usd: 0, first: 0, share: 0, lastAt: 0 };
  const first = ((f.refFirstUsd || 0) * S.firstPct) / 100;
  const windowEnd = f.refRewardAt + S.dailyDays * DAY;
  let payouts = 0;
  let lastAt = f.refRewardAt;
  for (const c of real) {
    const from = Math.max(c.startedAt ?? f.refRewardAt, f.refRewardAt);
    const to = Math.min(now, windowEnd, from + c.days * DAY);
    const days = Math.max(0, Math.floor((to - from) / DAY));
    payouts += c.dailyUsd * days;
    if (days > 0) lastAt = Math.max(lastAt, from + days * DAY);
  }
  const cap = Math.max(0, (S.capPct / 100) * spend - (f.refBonusUsd || 0));
  const usd = Math.min(first + (payouts * S.dailyPct) / 100, cap);
  const firstPart = Math.min(first, usd);
  return { spend, usd, first: firstPart, share: usd - firstPart, lastAt };
}

const btc = (usd) => (usd / BTC_USD).toFixed(8);
const dateLabel = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

// A friend's rebate rate (%): what the code gave at sign-up, or more if the owner raised it since.
function rateOf(f) {
  const inv = store.users.get(f.refBy);
  const now = (inv?.refCodes || []).find((k) => k.code === f.refCode)?.rebate || 0;
  return Math.max(f.refRebate || 0, now);
}

// A referrer's friends and earnings. Earnings are what is left after each friend's rebate.
export function summary(userId) {
  userOf(userId);
  const S = settings();
  let total = 0;
  const byCode = new Map();
  const friends = [...store.users.values()]
    .filter((f) => f.refBy === userId)
    .sort((a, b) => (b.refAt || 0) - (a.refAt || 0))
    .map((f) => {
      const r = friendReward(userOf(f.id), S);
      const rate = rateOf(f);
      const net = (r.usd * (100 - rate)) / 100;
      total += net;
      const code = f.refCode || codeOf(userOf(userId));
      const g = byCode.get(code) || { friends: 0, usd: 0 };
      g.friends += 1;
      g.usd += net;
      byCode.set(code, g);
      return { id: f.id, who: mask(f.id), joined: dateLabel(f.refAt || Date.now()), status: f.refRewardAt ? 'active' : 'pending', earned: `+${btc(net)}`, code, rebate: rate };
    });
  return { friends, earnedUsd: total, earnedBtc: btc(total), byCode };
}

// What this user receives as a friend, from their inviter's rebate, in USD.
export function rebateUsd(userId) {
  const f = store.users.get(userId);
  if (!f?.refBy || !f.refRewardAt) return 0;
  return (friendReward(userOf(userId), settings()).usd * rateOf(f)) / 100;
}

// The rebate this user gets as a friend, or null when their code had none.
export function myRebate(userId) {
  const f = store.users.get(userId);
  const pct = f?.refBy ? rateOf(f) : 0;
  return pct > 0 ? { pct, btc: btc(rebateUsd(userId)) } : null;
}

// Added to the wallet balance: earnings as a referrer plus the rebate as a friend.
export const rewardBtc = (userId) => (summary(userId).earnedUsd + rebateUsd(userId)) / BTC_USD;

// Wallet activity for invite income: per friend one row for the first-purchase reward and one for the daily share
// (both after the friend's rebate), plus one row for the rebate this user gets as a friend. Worked out on read, like the balance.
export function historyOf(userId, now = Date.now()) {
  const S = settings();
  const out = [];
  const add = (label, usd, at) => {
    const amount = btc(usd);
    if (!(parseFloat(amount) > 0)) return;
    out.push({ kind: 'referral', label, at, amount: `+${amount}`, coin: 'BTC', net: 'BTC' });
  };
  for (const f of store.users.values()) {
    if (f.refBy !== userId || !f.refRewardAt) continue;
    const r = friendReward(userOf(f.id), S, now);
    const keep = (100 - rateOf(f)) / 100;
    add(`Invite bonus · ${mask(f.id)}`, r.first * keep, f.refRewardAt);
    add(`Invite payouts · ${mask(f.id)}`, r.share * keep, r.lastAt);
  }
  const me = store.users.get(userId);
  if (me?.refBy && me.refRewardAt) {
    const rate = rateOf(me);
    if (rate > 0) add(`Invite rebate · ${rate}%`, (friendReward(userOf(userId), S, now).usd * rate) / 100, friendReward(userOf(userId), S, now).lastAt);
  }
  return out;
}

// Codes of one user with their friends and earnings. The default code is always first.
export function codesOf(userId) {
  const u = userOf(userId);
  const { byCode } = summary(userId);
  const row = (code, name, rebate, isDefault) => {
    const g = byCode.get(code) || { friends: 0, usd: 0 };
    return { code, name, rebate, default: isDefault, friends: g.friends, earnedBtc: btc(g.usd) };
  };
  return [row(codeOf(u), 'Default', 0, true), ...(u.refCodes || []).map((k) => row(k.code, k.name, k.rebate, false))];
}

const bad = (error) => ({ ok: false, status: 422, error });

function cleanRebate(v, S) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > S.maxRebate) return null;
  return n;
}

export function createCode(userId, input) {
  const u = userOf(userId);
  const S = settings();
  const name = String(input?.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 20);
  if (!name) return bad('Give the code a name.');
  const rebate = cleanRebate(input?.rebate, S);
  if (rebate === null) return bad(`Rebate must be a whole number from 0 to ${S.maxRebate}.`);
  u.refCodes ||= [];
  if (u.refCodes.length + 1 >= S.maxCodes) return bad(`You can have up to ${S.maxCodes} codes.`);
  if (u.refCodes.some((k) => k.name.toLowerCase() === name.toLowerCase())) return bad('You already have a code with this name.');
  u.refCodes.push({ code: newCode(), name, rebate, at: Date.now() });
  return { ok: true, status: 200 };
}

// A rebate can only be raised, never lowered, so friends keep what they signed up for.
export function raiseCode(userId, code, rebateIn) {
  const u = userOf(userId);
  const S = settings();
  const k = (u.refCodes || []).find((x) => x.code === String(code));
  if (!k) return { ok: false, status: 404, error: 'Code not found.' };
  const rebate = cleanRebate(rebateIn, S);
  if (rebate === null) return bad(`Rebate must be a whole number from 0 to ${S.maxRebate}.`);
  if (rebate < k.rebate) return bad('A rebate can only be raised, not lowered.');
  k.rebate = rebate;
  return { ok: true, status: 200 };
}

// A code with friends cannot be removed, because their rebate depends on it.
export function deleteCode(userId, code) {
  const u = userOf(userId);
  const i = (u.refCodes || []).findIndex((x) => x.code === String(code));
  if (i < 0) return { ok: false, status: 404, error: 'Code not found.' };
  if ([...store.users.values()].some((f) => f.refBy === userId && f.refCode === u.refCodes[i].code)) return bad('This code has friends, so it cannot be removed.');
  u.refCodes.splice(i, 1);
  return { ok: true, status: 200 };
}

// Shown on the sign-up screen before the friend joins.
export function publicCode(code) {
  const hit = resolveCode(code);
  return hit ? { valid: true, rebate: hit.rebate } : { valid: false, rebate: 0 };
}

export function rulesText(S = settings()) {
  return [
    `Inviting unlocks when you buy any plan, or at least $${INVITE_MIN_USD} of custom power.`,
    'Share your code or link. Your friend enters it when signing up.',
    ...(S.refereeTh > 0 ? [`Your friend gets ${S.refereeTh} TH/s free for ${S.refereeDays} days with a first purchase of $${S.refereeMinUsd} or more.`] : []),
    `You earn ${S.firstPct}% of their first purchase, plus ${S.dailyPct}% of their daily payouts for ${S.dailyDays} days, paid in BTC.`,
    `Rewards start once their first purchase is active and are capped at ${S.capPct}% of what they spend.`,
    `You can create named codes that pass part of your reward to your friends as a rebate (up to ${S.maxRebate}%). A friend keeps the rebate they signed up with.`,
    `Up to ${S.monthlyLimit} rewarded friends per month. Self-referrals and duplicate accounts are not rewarded.`,
  ];
}

// Called when a purchase goes live. Gives the friend their gift and starts the referrer's rewards.
// Returns the gift miner, or null when nothing applied.
export function onPurchase(buyerId, plan) {
  const f = userOf(buyerId);
  const S = settings();
  if (!f.refBy || f.refBonusAt || !(plan.price >= S.refereeMinUsd)) return null;
  const inv = store.users.get(f.refBy);
  if (!inv) return null;
  const now = Date.now();
  f.refBonusAt = now;
  f.refFirstUsd = plan.price;

  let bonus = null;
  if (S.refereeTh > 0) {
    const th = S.refereeTh;
    const hall = hallFor(th);
    bonus = {
      ...makeContract({ name: 'Welcome', th, hall, days: S.refereeDays, daily: `$${(th * catalog().halls[hall].net).toFixed(2)}`, price: 0 }, takeSerial()),
      bonus: true,
    };
    f.contracts.push(bonus);
    f.refBonusUsd = bonus.dailyUsd * bonus.days;
    notify(f, { kind: 'referral', title: 'Welcome gift', body: `${th} TH/s free for ${S.refereeDays} days (${bonus.serial})` });
  }

  const d = new Date(now);
  const rewardedThisMonth = [...store.users.values()].filter((x) => {
    if (x.refBy !== inv.id || !x.refRewardAt) return false;
    const r = new Date(x.refRewardAt);
    return r.getFullYear() === d.getFullYear() && r.getMonth() === d.getMonth();
  }).length;
  if (rewardedThisMonth < S.monthlyLimit) {
    f.refRewardAt = now;
    const first = friendReward(f, S, now).usd;
    notify(inv, { kind: 'referral', title: 'Friend started mining', body: `${mask(f.id)} bought a plan. You earned $${first.toFixed(2)} so far` });
  }
  return bonus;
}

// Everything the admin Referrals tab shows.
export function adminView() {
  const S = settings();
  const all = [...store.users.values()];
  return {
    settings: S,
    codes: all.map((u) => ({ id: u.id, code: codeOf(u) })),
    links: all
      .filter((f) => f.refBy)
      .map((f) => {
        const r = friendReward(userOf(f.id), S);
        return { friend: f.id, inviter: f.refBy, gift: !!f.refBonusAt, rewarded: !!f.refRewardAt, spendUsd: Math.round(r.spend * 100) / 100, rewardUsd: Math.round(r.usd * 100) / 100, rebate: rateOf(f) };
      }),
  };
}
