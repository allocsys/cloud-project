// Dashboard numbers, notifications and referrals. Storage lives in lib/server/db.js.
import { earnings, stats, referral, TODAY_BTC } from '@/lib/data';
import { customPlan } from '@/lib/data';
import { userOf, catalog } from '@/lib/server/db';

// Invites unlock with any package, or with at least this much spent on custom power.
export const INVITE_MIN_USD = 10;

// The charts and uptime are placeholders; totalTh follows the miners the user actually owns.
export function getDashboard(userId = 'demo') {
  const u = userOf(userId);
  return { totalTh: u.contracts.reduce((s, c) => s + c.th, 0), todayBtc: TODAY_BTC, earnings, stats };
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
    .filter((c) => c.plan === 'Custom')
    .reduce((s, c) => s + (Number.isFinite(c.price) ? c.price : customPlan(c.th, c.days, halls).price), 0);
}

export function inviteGate(userId = 'demo') {
  const u = userOf(userId);
  const hasPackage = u.contracts.some((c) => c.plan !== 'Custom');
  const spent = customSpend(u);
  return { unlocked: hasPackage || spent >= INVITE_MIN_USD, minUsd: INVITE_MIN_USD, spentUsd: +Math.min(spent, INVITE_MIN_USD).toFixed(2) };
}

// The code and friends list are per user once real accounts exist. The code stays hidden until unlocked.
export function getReferral(userId = 'demo') {
  const gate = inviteGate(userId);
  return gate.unlocked ? { ...referral, ...gate } : { ...referral, code: null, ...gate };
}
