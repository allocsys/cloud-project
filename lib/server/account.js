// Dashboard numbers, notifications and referrals. Storage lives in lib/server/db.js.
import { earnings, stats, referral, TODAY_BTC } from '@/lib/data';
import { userOf } from '@/lib/server/db';

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

// The code and friends list are per user once real accounts exist.
export const getReferral = () => referral;
