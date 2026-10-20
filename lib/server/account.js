// Dashboard numbers, notifications and referrals. Storage lives in lib/server/db.js.
import { customPlan } from '@/lib/data';
import { buildEarnings } from '@/lib/earnings';
import { getUser, withUser, catalog } from '@/lib/server/db';
import { INVITE_MIN_USD, settings, codeOf, summaryOf, myRebateOf, rulesText, getRefCtx, codesOfCtx } from '@/lib/server/referrals';

// Earnings, hashrate and uptime are worked out from the miners the user actually owns (lib/earnings.js).
export async function getDashboard(userId = 'demo') {
  const now = Date.now();
  return { ...buildEarnings((await getUser(userId)).contracts, now), asOf: now };
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

// Spent on custom power (older miners without a saved price are priced from the live halls).
function customSpend(u) {
  const halls = catalog().halls;
  return u.contracts
    .filter((c) => c.plan === 'Custom' && !c.bonus)
    .reduce((s, c) => s + (Number.isFinite(c.price) ? c.price : customPlan(c.th, c.days, halls).price), 0);
}

function gateOf(u) {
  // Invites unlock with any package, or with at least INVITE_MIN_USD spent on custom power. Gift miners do not count.
  const hasPackage = u.contracts.some((c) => c.plan !== 'Custom' && !c.bonus);
  const spent = customSpend(u);
  return { unlocked: hasPackage || spent >= INVITE_MIN_USD, minUsd: INVITE_MIN_USD, spentUsd: +Math.min(spent, INVITE_MIN_USD).toFixed(2) };
}

export async function inviteGate(userId = 'demo') {
  return gateOf(await getUser(userId));
}

// The code and friends list are per user once real accounts exist. The code stays hidden until unlocked.
export async function getReferral(userId = 'demo') {
  const ctx = await getRefCtx(userId);
  const gate = gateOf(ctx.u);
  const S = settings();
  const s = summaryOf(ctx);
  const base = {
    code: codeOf(ctx.u),
    codes: codesOfCtx(ctx),
    limits: { maxRebate: S.maxRebate, maxCodes: S.maxCodes },
    rebate: myRebateOf(ctx), // what this user gets back as a friend, when their code had a rebate
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
