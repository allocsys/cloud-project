// The numbers users are told about, in one place. Change a number here and the app, the FAQ and the Terms follow.
// No imports, so the browser, the server and the plain-node tests can all use it.
// Smart Mining's own numbers (terms, budget range, pay table, reserve) live in lib/smart.js; the referral programme's
// admin-editable settings live in lib/server/referrals.js. The wording of the FAQ and Terms is NOT here: it stays in
// lib/faq.js and app/terms/page.js and only reads these numbers. tests/rules.test.mjs fails if text and numbers disagree.
// The payment gateway is a separate service: its MIN_DEPOSIT_USD (gateway/src/invoices.js) must equal the one below (tested).

// Charged on the USD value when a deposit or a withdrawal is in anything other than BTC.
export const SWAP_FEE_PCT = 1;

// Withdrawal service fee, by days since the last withdrawal (or the first purchase). Approved 24 Oct 2026: 2% under 7 days,
// 1% from 7 to 30 days, 0% from 31 days. The text helpers below expect three tiers: from 0, a middle one, and a free one.
export const SERVICE_TIERS = [
  { from: 0, pct: 2 },
  { from: 7, pct: 1 },
  { from: 31, pct: 0 },
];

// An account with no plan can bring in this many friends; a plan, or INVITE_MIN_USD of custom power, removes the limit.
export const FREE_INVITES = 3;
export const INVITE_MIN_USD = 10;

// A full refund is possible this many hours after buying, until the miner's first payout day has finished.
export const REFUND_HOURS = 24;

// Smallest withdrawal (in dollars of the coin withdrawn) and smallest wallet top-up.
export const MIN_WITHDRAW_USD = 15;
export const MIN_DEPOSIT_USD = 30;

// An hour counts as up when a sample reached this share of the contracted hashrate.
export const UP_RATIO = 0.9;

// "2% if it's been under 7 days, 1% from 7 to 30 days, and no fee from 31 days" (used in the FAQ).
export function serviceTiersText(tiers = SERVICE_TIERS) {
  const [a, b, c] = tiers;
  return `${a.pct}% if it\u2019s been under ${b.from} days, ${b.pct}% from ${b.from} to ${c.from - 1} days, and no fee from ${c.from} days`;
}

// "2%, 1% or 0%" (used in the Terms).
export function servicePctText(tiers = SERVICE_TIERS) {
  const p = tiers.map((t) => `${t.pct}%`);
  return `${p.slice(0, -1).join(', ')} or ${p[p.length - 1]}`;
}
