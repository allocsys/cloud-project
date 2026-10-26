// Dashboard numbers, notifications and referrals. Storage lives in lib/server/db.js.
import { BTC_USD, account } from '@/lib/data';
import { buildEarnings } from '@/lib/earnings';
import { getUser, withUser } from '@/lib/server/db';
import { getMarket } from '@/lib/server/market';
import { telemetryFor } from '@/lib/server/telemetry';
import { INVITE_MIN_USD, FREE_INVITES, inviteSpend, inviteUnlocked, settings, ticketsOn, codeOf, summaryOf, myRebateOf, rulesText, getRefCtx, codesOfCtx } from '@/lib/server/referrals';

// Invite links use a fixed public address, never the request's Host header. Set APP_URL once the app has its own domain.
const BASE_URL = (process.env.APP_URL || 'https://opus-cloud-mining-production.up.railway.app').replace(/\/+$/, '');

// Earnings, hashrate and uptime are worked out from the miners the user actually owns (lib/earnings.js).
export async function getDashboard(userId = 'demo') {
  const now = Date.now();
  const [u, market] = await Promise.all([getUser(userId), getMarket()]);
  const telemetry = await telemetryFor(u.contracts, now); // null while the admin has the mock charts on
  return { ...buildEarnings(u.contracts, now, BTC_USD, market, telemetry), asOf: now };
}

function whenLabel(n, now) {
  if (!n.at) return n.when;
  const s = Math.floor((now - n.at) / 1000);
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(n.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export async function getNotifications(userId = 'demo') {
  const u = await getUser(userId);
  const now = Date.now();
  const items = u.notifications.map((n) => ({ ...n, when: whenLabel(n, now) }));
  return { items, unread: items.filter((n) => !n.read).length };
}

export async function markAllRead(userId = 'demo') {
  await withUser(userId, (u) => {
    u?.notifications.forEach((n) => {
      n.read = true;
    });
  });
  return { ok: true };
}

export async function clearNotifications(userId = 'demo') {
  await withUser(userId, (u) => {
    if (u) u.notifications.length = 0;
  });
  return { ok: true };
}

// Alert preferences live in the account document (users.data.prefs); anything not saved yet uses the defaults.
const ALERT_KEYS = ['payouts', 'withdrawals', 'news'];

export async function getSettings(userId = 'demo') {
  const u = await getUser(userId);
  return { alerts: { ...account.alerts, ...(u.prefs?.alerts || {}) } };
}

// patch: { alerts: { payouts?: boolean, withdrawals?: boolean, news?: boolean } }. Unknown keys and non-booleans are ignored.
export async function saveSettings(userId, patch) {
  const next = {};
  for (const k of ALERT_KEYS) if (typeof patch?.alerts?.[k] === 'boolean') next[k] = patch.alerts[k];
  if (!Object.keys(next).length) return { ok: false, status: 400, error: 'Nothing to save.' };
  const found = await withUser(userId, (u) => {
    if (!u) return false;
    u.prefs = { ...(u.prefs || {}), alerts: { ...(u.prefs?.alerts || {}), ...next } };
    return true;
  });
  if (!found) return { ok: false, status: 404, error: 'Account not found.' };
  return { ok: true, status: 200, ...(await getSettings(userId)) };
}

// Invites: free for FREE_INVITES friends, then they unlock with any package or INVITE_MIN_USD of custom power (see referrals.js).
// `unlocked` means no limit; `left` is how many free invites remain (null once unlocked).
function gateOf(u, invited = 0) {
  const unlocked = inviteUnlocked(u);
  return { unlocked, minUsd: INVITE_MIN_USD, spentUsd: +Math.min(inviteSpend(u), INVITE_MIN_USD).toFixed(2), freeInvites: FREE_INVITES, invited, left: unlocked ? null : Math.max(0, FREE_INVITES - invited) };
}

export async function inviteGate(userId = 'demo') {
  return gateOf(await getUser(userId));
}

// The code and friends list are per user once real accounts exist. The code is shown to everyone; without a plan the limit is FREE_INVITES friends.
export async function getReferral(userId = 'demo') {
  const ctx = await getRefCtx(userId);
  const gate = gateOf(ctx.u, ctx.friends.length);
  const S = settings();
  const s = summaryOf(ctx);
  const base = {
    code: codeOf(ctx.u),
    codes: codesOfCtx(ctx),
    limits: { maxRebate: S.maxRebate, maxCodes: S.maxCodes },
    rebate: myRebateOf(ctx), // what this user gets back as a friend, when their code had a rebate
    linkBase: BASE_URL,
    ratePct: S.firstPct,
    reward: `${S.firstPct}% + ${S.dailyPct}% daily`,
    rewardV: { first: S.firstPct, daily: S.dailyPct },
    gift: S.refereeTh > 0 ? `${S.refereeTh} TH/s free for ${S.refereeDays} days` : '',
    giftV: S.refereeTh > 0 ? { th: S.refereeTh, days: S.refereeDays } : null,
    rules: rulesText(S),
    rulesV: {
      free: FREE_INVITES,
      inviteMin: INVITE_MIN_USD,
      th: S.refereeTh,
      days: S.refereeDays,
      refMin: S.refereeMinUsd,
      tickets: ticketsOn(S) ? S.ticketCap : 0,
      first: S.firstPct,
      daily: S.dailyPct,
      dailyDays: S.dailyDays,
      cap: S.capPct,
      max: S.maxRebate,
      monthly: S.monthlyLimit,
    },
    earnedBtc: s.earnedBtc,
    friends: s.friends,
    ...gate,
  };
  return base;
}
