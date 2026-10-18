// Dashboard numbers, notifications and referrals. Storage lives in lib/server/db.js.
import { customPlan } from '@/lib/data';
import { buildEarnings } from '@/lib/earnings';
import { userOf, catalog } from '@/lib/server/db';
import { INVITE_MIN_USD, settings, codeOf, summary, rulesText } from '@/lib/server/referrals';

// Earnings, hashrate and uptime are worked out from the miners the user actually owns (lib/earnings.js).
export function getDashboard(userId = 'demo') {
  return buildEarnings(userOf(userId).contracts);
}

function whenLabel(n, now) {
  if (!n.at) return n.when;
  const s = Math.floor((now - n.at) / 1000);
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(n.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function getNotifications(userId = 'demo') {
  const u = userOf(userId);
  const now = Date.now();
  const items = u.notifications.map((n) => ({ ...n, when: whenLabel(n, now) }));
  return { items, unread: items.filter((n) => !n.read).length };
}

export function markAllRead(userId = 'demo') {
  userOf(userId).notifications.forEach((n) => {
    n.read = true;
  });
  return { ok: true };
}

export function clearNotifications(userId = 'demo') {
  userOf(userId).notifications.length = 0;
  return { ok: true };
}

// Spent on custom power (older miners without a saved price are priced from the live halls).
function customSpend(u) {
  const halls = catalog().halls;
  return u.contracts
    .filter((c) => c.plan === 'Custom' && !c.bonus)
    .reduce((s, c) => s + (Number.isFinite(c.price) ? c.price : customPlan(c.th, c.days, halls).price), 0);
}

export function inviteGate(userId = 'demo') {
  const u = userOf(userId);
  // Invites unlock with any package, or with at least INVITE_MIN_USD spent on custom power. Gift miners do not count.
  const hasPackage = u.contracts.some((c) => c.plan !== 'Custom' && !c.bonus);
  const spent = customSpend(u);
  return { unlocked: hasPackage || spent >= INVITE_MIN_USD, minUsd: INVITE_MIN_USD, spentUsd: +Math.min(spent, INVITE_MIN_USD).toFixed(2) };
}

// The code and friends list are per user once real accounts exist. The code stays hidden until unlocked.
export function getReferral(userId = 'demo') {
  const gate = inviteGate(userId);
  const S = settings();
  const s = summary(userId);
  const base = {
    code: codeOf(userOf(userId)),
    ratePct: S.firstPct,
    reward: `${S.firstPct}% + ${S.dailyPct}% daily`,
    gift: S.refereeTh > 0 ? `${S.refereeTh} TH/s free for ${S.refereeDays} days` : '',
    rules: rulesText(S),
    earnedBtc: s.earnedBtc,
    friends: s.friends,
    ...gate,
  };
  return gate.unlocked ? base : { ...base, code: null };
}
