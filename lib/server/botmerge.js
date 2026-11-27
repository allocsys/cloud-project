// Linking an email account to a Telegram id when that Telegram id already has its own account (tg:<id>): the two become one.
// The email account stays (email, password, two-factor, sign-in); the Telegram account is closed into it and nothing is lost:
//   money     withdrawn, spent, adjust, deposited and free tickets are added, so the balance is the sum of both
//   miners    both lists, history, boosts and notifications are joined; the orders, withdrawals, refund requests and ledger rows move over
//   friends   everybody the Telegram account invited now belongs to the email account, and so do its invite codes
//   inviter   the Telegram account's own inviter is kept when the email account has none; if both were invited, the email account keeps
//             its inviter, the rebate the Telegram account had earned so far is added to its balance, and the closed record keeps the
//             Telegram account's inviter link (and a copy of its miners) so that inviter's rewards never change
// An empty side simply adds nothing, so "empty loses to non-empty" and "both have money: add it" are the same code.
// Runs inside the caller's transaction with both account rows locked (lib/server/botlink.js). Nothing here may do network calls.
import { randomBytes } from 'node:crypto';
import { FREE_INVITES } from '@/lib/rules';
import { ledger } from '@/lib/server/db';
import { refCtxFor, rebateBtcOf } from '@/lib/server/referrals';

const fail = (status, error) => ({ ok: false, status, error });

// Numbers that are added together.
const SUM = ['withdrawn', 'spent', 'adjust', 'deposited', 'freeTickets', 'refTickets'];
// What an account carries as somebody's friend (who invited it, its first purchase, its reward start and rates).
const REF_FIELDS = ['refBy', 'refAt', 'refUsed', 'refRebate', 'refBonusAt', 'refBonusUsd', 'refFirstUsd', 'refFirstSerial', 'refFirstVoid', 'refRewardAt', 'refRates', 'refRatesPending', 'refSameNet', 'refStartNote'];
// Never copied by the "fill what is missing" step: identity and sign-in data stay with the email account, the rest is handled above or below.
const NOT_COPIED = new Set([
  ...SUM,
  ...REF_FIELDS,
  'contracts', 'history', 'notifications', 'boosts', 'push', 'kyc', 'inviteCap',
  'id', 'createdAt', 'closedAt', 'botLink', 'botTg', 'pw', 'pwAt', 'email', 'emailVerified', 'twofa', 'twofaPending', 'wdTg', 'wdMail', 'wdFrozen',
  'blocked', 'reset', 'lastIn', 'cv', 'vipSeen', 'vipWarn', 'vipTicketsGiven',
]);

const byAtDesc = (a, b) => (b?.at || 0) - (a?.at || 0);
const list = (v) => (Array.isArray(v) ? v : []);

// t = the email account, s = the Telegram account (both locked and hydrated by the caller), market = warmed before the lock.
// Changes t in memory (the caller saves it), moves the other rows with SQL and renames the Telegram row to a closed record.
export async function mergeTelegram(c, t, s, market) {
  if (s.blocked || s.closedAt || s.wdFrozen) return fail(403, 'This Telegram account cannot be merged. Contact support.');
  // An unfinished payment or withdrawal is still being worked on by its own id: wait until it is done, as when closing an account.
  const open = (
    await c.query("SELECT (SELECT count(*) FROM withdrawals WHERE user_id = $1 AND status IN ('pending', 'approved'))::int AS w, (SELECT count(*) FROM orders WHERE user_id = $1 AND status IN ('pending', 'review'))::int AS o", [s.id])
  ).rows[0];
  if (open.w || open.o) return fail(423, 'Finish the unfinished payment or withdrawal first, then try again.');

  // The email account was invited by the Telegram account: it cannot be its own friend any more.
  if (t.refBy === s.id) for (const k of REF_FIELDS) delete t[k];
  // The Telegram account's inviter: taken over when the email account has none, else the email account's inviter stays.
  const adopt = !t.refBy && !!s.refBy && s.refBy !== t.id;
  const lost = !!s.refBy && !adopt && s.refBy !== t.id; // its rebate as a friend would end with the Telegram account
  const keepRef = lost && t.refBy !== s.refBy; // a different inviter: that inviter keeps earning from the closed record
  if (lost) {
    const rebate = rebateBtcOf(await refCtxFor(s, c, market));
    if (rebate > 0) t.adjust = (t.adjust || 0) + rebate;
  }
  if (adopt) for (const k of REF_FIELDS) if (s[k] !== undefined) t[k] = s[k];

  for (const k of SUM) if (s[k]) t[k] = (t[k] || 0) + s[k];
  if (Number.isFinite(s.inviteCap)) t.inviteCap = Math.max(t.inviteCap ?? FREE_INVITES, s.inviteCap);
  t.contracts = [...list(t.contracts), ...list(s.contracts)];
  t.history = [...list(t.history), ...list(s.history)].sort(byAtDesc);
  t.notifications = [...list(t.notifications), ...list(s.notifications)].sort(byAtDesc).slice(0, 50);
  if (list(s.boosts).length) t.boosts = [...list(t.boosts), ...s.boosts];
  if (list(s.push).length) {
    const have = new Set(list(t.push).map((p) => p?.t));
    t.push = [...list(t.push), ...s.push.filter((p) => p && !have.has(p.t))];
  }
  if ((t.kyc?.status ?? 'none') === 'none' && s.kyc && s.kyc.status !== 'none') t.kyc = s.kyc;
  for (const [k, v] of Object.entries(s)) if (!NOT_COPIED.has(k) && t[k] === undefined) t[k] = v;

  // The rows that belong to the Telegram account move to the email account. Its default invite code becomes a named one (an account has one default).
  await c.query("UPDATE codes SET user_id = $2, name = CASE WHEN is_default THEN 'Telegram' ELSE name END, is_default = false WHERE user_id = $1", [s.id, t.id]);
  for (const table of ['orders', 'withdrawals', 'refund_requests', 'ledger']) await c.query(`UPDATE ${table} SET user_id = $2 WHERE user_id = $1`, [s.id, t.id]);
  await c.query("UPDATE users SET ref_by = $2, data = jsonb_set(data, '{refBy}', to_jsonb($2::text)) WHERE ref_by = $1 AND id <> $2", [s.id, t.id]);

  // The Telegram row becomes a closed record (like a closed account, lib/server/auth.js eraseAccount): no sign-in, no balance, no name.
  const gone = `closed:${randomBytes(9).toString('base64url')}`;
  const shell = { id: gone, closedAt: Date.now(), mergedInto: t.id };
  for (const k of ['createdAt', 'cv', 'netKey', 'ticketGot']) if (s[k] !== undefined) shell[k] = s[k];
  if (keepRef) {
    shell.contracts = s.contracts;
    for (const k of REF_FIELDS) if (s[k] !== undefined) shell[k] = s[k];
  }
  await c.query('UPDATE users SET id = $2, data = $3::jsonb, ref_by = $4, updated_at = now() WHERE id = $1', [s.id, gone, JSON.stringify(shell), shell.refBy || null]);
  await ledger(c, t.id, 'merge', { btc: 0, ref: `from ${s.id}` });
  return { ok: true };
}
