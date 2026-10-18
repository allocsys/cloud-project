// Referral programme: invite codes, who invited whom, editable reward settings and the rewards themselves.
// Storage lives in lib/server/db.js (per-user fields refBy, refAt, refBonusAt, refRewardAt, ...; settings in store.refSettings).
//
// Friend (referee): gets a free miner after their first purchase of refereeMinUsd or more.
// Referrer: gets firstPct of that first purchase, plus dailyPct of the friend's daily payouts for dailyDays.
// Everything the referrer earns is capped at capPct of what the friend spends, minus the cost of the free miner.
// Rewards are worked out on read from timestamps, so no daily job is needed.
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
};

export const settings = () => ({ ...DEFAULTS, ...(store.refSettings || {}) });

export function saveSettings(input) {
  const next = {};
  for (const [k, [label, lo, hi, whole]] of Object.entries(LIMITS)) {
    const v = Number(String(input?.[k] ?? '').trim().replace(',', '.'));
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

export function findByCode(code, exceptId) {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return null;
  for (const u of store.users.values()) if (u.id !== exceptId && codeOf(u).toUpperCase() === c) return u;
  return null;
}

// Every user gets one stable code. The demo user keeps the code the app always showed.
export function codeOf(u) {
  if (!u.refCode) {
    if (u.id === 'demo') u.refCode = 'OPUS-7K2M';
    else {
      do {
        u.refCode = `OPUS-${Array.from({ length: 4 }, () => ALPHA[randomInt(ALPHA.length)]).join('')}`;
      } while (findByCode(u.refCode, u.id));
    }
  }
  return u.refCode;
}

export function mask(id) {
  const s = String(id);
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
  const inv = findByCode(code, friendId);
  if (!inv) return { ok: false, status: 404, error: 'Invite code not found.' };
  f.refBy = inv.id;
  f.refAt = Date.now();
  notify(inv, { kind: 'referral', title: 'A friend joined', body: `${mask(friendId)} signed up with your code` });
  return { ok: true, status: 200, inviter: inv.id };
}

const DAY = 86400000;

// Reward earned so far from one friend, in USD.
function friendReward(f, S, now = Date.now()) {
  const real = f.contracts.filter((c) => !c.bonus);
  const spend = real.reduce((s, c) => s + priceOf(c), 0);
  if (!f.refRewardAt) return { spend, usd: 0 };
  const first = ((f.refFirstUsd || 0) * S.firstPct) / 100;
  const windowEnd = f.refRewardAt + S.dailyDays * DAY;
  let payouts = 0;
  for (const c of real) {
    const from = Math.max(c.startedAt ?? f.refRewardAt, f.refRewardAt);
    const to = Math.min(now, windowEnd, from + c.days * DAY);
    payouts += c.dailyUsd * Math.max(0, Math.floor((to - from) / DAY));
  }
  const cap = Math.max(0, (S.capPct / 100) * spend - (f.refBonusUsd || 0));
  return { spend, usd: Math.min(first + (payouts * S.dailyPct) / 100, cap) };
}

const btc = (usd) => (usd / BTC_USD).toFixed(8);
const dateLabel = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

// A referrer's friends and earnings.
export function summary(userId) {
  userOf(userId);
  const S = settings();
  let total = 0;
  const friends = [...store.users.values()]
    .filter((f) => f.refBy === userId)
    .sort((a, b) => (b.refAt || 0) - (a.refAt || 0))
    .map((f) => {
      const r = friendReward(userOf(f.id), S);
      total += r.usd;
      return { id: f.id, who: mask(f.id), joined: dateLabel(f.refAt || Date.now()), status: f.refRewardAt ? 'active' : 'pending', earned: `+${btc(r.usd)}` };
    });
  return { friends, earnedUsd: total, earnedBtc: btc(total) };
}

// Added to the wallet balance.
export const rewardBtc = (userId) => summary(userId).earnedUsd / BTC_USD;

export function rulesText(S = settings()) {
  return [
    `Inviting unlocks when you buy any plan, or at least $${INVITE_MIN_USD} of custom power.`,
    'Share your code or link. Your friend enters it when signing up.',
    ...(S.refereeTh > 0 ? [`Your friend gets ${S.refereeTh} TH/s free for ${S.refereeDays} days with a first purchase of $${S.refereeMinUsd} or more.`] : []),
    `You earn ${S.firstPct}% of their first purchase, plus ${S.dailyPct}% of their daily payouts for ${S.dailyDays} days, paid in BTC.`,
    `Rewards start once their first purchase is active and are capped at ${S.capPct}% of what they spend.`,
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
        return { friend: f.id, inviter: f.refBy, gift: !!f.refBonusAt, rewarded: !!f.refRewardAt, spendUsd: Math.round(r.spend * 100) / 100, rewardUsd: Math.round(r.usd * 100) / 100 };
      }),
  };
}
