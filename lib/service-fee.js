// Withdrawal service fee: a small percentage of the amount withdrawn that falls the longer it has been since the
// account's last withdrawal (or since its first purchase, when it has not withdrawn yet). Reinvesting is never charged.
// Only imports lib/rules.js (which has no imports), so the browser, the server and the plain-node tests can use it.
// Approved by the owner on 24 Oct 2026: 2% under 7 days, 1% from 7 to 30 days, 0% from 31 days.

import { SERVICE_TIERS } from './rules.js';
export { SERVICE_TIERS }; // the numbers live in lib/rules.js

const DAY = 86_400_000;

// `since` is a timestamp in ms. Without one the fee is the top tier.
// -> { pct, nextPct (null on the last tier), daysLeft (whole days until the next tier, at least 1; 0 on the last tier) }
export function serviceTier(since, now = Date.now()) {
  const days = since ? Math.max(0, (now - since) / DAY) : 0;
  let i = 0;
  while (i + 1 < SERVICE_TIERS.length && days >= SERVICE_TIERS[i + 1].from) i += 1;
  const next = SERVICE_TIERS[i + 1];
  return {
    pct: SERVICE_TIERS[i].pct,
    nextPct: next ? next.pct : null,
    daysLeft: next ? Math.max(1, Math.ceil(next.from - days)) : 0,
  };
}

const inDays = (n) => `${n} day${n === 1 ? '' : 's'}`;

// The line under the wallet's Withdraw form.
export function serviceLine(t) {
  if (t.nextPct === null) return 'No service fee. Withdraw free.';
  return t.nextPct === 0 ? `Service fee ${t.pct}%. Free in ${inDays(t.daysLeft)}.` : `Service fee ${t.pct}%. Drops to ${t.nextPct}% in ${inDays(t.daysLeft)}.`;
}
