// Site switches the admin can flip. They live in the meta entry "flags" (shared with mockCharts, see telemetry.js).
//
//   showDemo    true (the default) shows "Explore the demo first" on the sign-in sheet; false hides it. Admin > Settings > Demo account.
//               This only hides the button. Demo access is closed by default; REQUIRE_AUTH=0 opens it.
//   reviewUrl   the public page where people can leave a review (like a Trustpilot page), shown after a user rates the app.
//               Empty = no link. Admin > Settings > Reviews.
//   minDeposit  the smallest wallet top-up in dollars. Not set = MIN_DEPOSIT_USD ($30). Admin > Settings > Minimum deposit.
//   minWithdraw the smallest withdrawal in dollars of the coin withdrawn. Not set = MIN_WITHDRAW_USD ($15). Admin > Settings > Minimum withdrawal.
//               The screens read it from GET /api/plans (minWithdraw); the server check is in lib/server/wallet.js.
import { warm, metaGet, metaUpdate } from '@/lib/server/db';
import { MIN_DEPOSIT_USD, MIN_WITHDRAW_USD } from '@/lib/data';

export const MIN_DEPOSIT_LOW = 1;
export const MIN_DEPOSIT_HIGH = 10000;
export const MIN_WITHDRAW_LOW = 1;
export const MIN_WITHDRAW_HIGH = 10000;

export async function showDemo() {
  await warm();
  return metaGet('flags')?.showDemo !== false;
}

export function setShowDemo(on) {
  return metaUpdate('flags', (cur) => ({ value: { ...(cur || {}), showDemo: !!on }, result: !!on }));
}

export async function reviewUrl() {
  await warm();
  return String(metaGet('flags')?.reviewUrl || '');
}

export function setReviewUrl(url) {
  return metaUpdate('flags', (cur) => ({ value: { ...(cur || {}), reviewUrl: url }, result: url }));
}

export async function minDeposit() {
  await warm();
  const v = Number(metaGet('flags')?.minDeposit);
  return v >= MIN_DEPOSIT_LOW && v <= MIN_DEPOSIT_HIGH ? v : MIN_DEPOSIT_USD;
}

export async function minWithdraw() {
  await warm();
  const v = Number(metaGet('flags')?.minWithdraw);
  return v >= MIN_WITHDRAW_LOW && v <= MIN_WITHDRAW_HIGH ? v : MIN_WITHDRAW_USD;
}

// usd: a number, or null to go back to the default.
export function setMinWithdraw(usd) {
  return metaUpdate('flags', (cur) => {
    const next = { ...(cur || {}) };
    if (usd == null) delete next.minWithdraw;
    else next.minWithdraw = usd;
    return { value: next, result: usd == null ? MIN_WITHDRAW_USD : usd };
  });
}

// usd: a number, or null to go back to the default.
export function setMinDeposit(usd) {
  return metaUpdate('flags', (cur) => {
    const next = { ...(cur || {}) };
    if (usd == null) delete next.minDeposit;
    else next.minDeposit = usd;
    return { value: next, result: usd == null ? MIN_DEPOSIT_USD : usd };
  });
}
