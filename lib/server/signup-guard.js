// Account farming guard: one network (the keyed /24 or /64 hash from netKeyOf in auth.js) can open only a few new accounts in 24 hours.
// Email and Telegram sign-ups both count, closed accounts too (they keep netKey and createdAt). Opening an existing account is never limited.
// An unknown address (no netKey) is never limited. Settings live in the meta entry "signupguard". Admin > Settings > Sign-up limit.
//   on       true (the default) = the limit is enforced; false = off.
//   perDay   new accounts one network may open in 24 hours. Default 3, from 1 to 50.
import { warm, metaGet, metaUpdate } from '@/lib/server/db';

export const SIGNUP_LIMIT = { def: 3, min: 1, max: 50 };
export const LIMIT_MSG = 'Too many new accounts from this network today. Try again tomorrow.';
const DAY_MS = 86400000;

export async function signupGuard() {
  await warm();
  const s = metaGet('signupguard') || {};
  const n = Math.floor(Number(s.perDay));
  return { on: s.on !== false, perDay: n >= SIGNUP_LIMIT.min && n <= SIGNUP_LIMIT.max ? n : SIGNUP_LIMIT.def };
}

// input: { enabled?: boolean, perDay?: number }. Only what is given changes.
export async function saveSignupGuard(input) {
  const next = {};
  if (input?.enabled !== undefined) {
    if (typeof input.enabled !== 'boolean') return { ok: false, status: 400, error: 'Choose on or off.' };
    next.on = input.enabled;
  }
  if (input?.perDay !== undefined && String(input.perDay).trim() !== '') {
    const n = Number(String(input.perDay).trim().replace(',', '.'));
    if (!Number.isInteger(n) || n < SIGNUP_LIMIT.min || n > SIGNUP_LIMIT.max) return { ok: false, status: 422, error: `Enter a whole number from ${SIGNUP_LIMIT.min} to ${SIGNUP_LIMIT.max}.` };
    next.perDay = n;
  }
  await metaUpdate('signupguard', (cur) => ({ value: { ...(cur || {}), ...next } }));
  return { ok: true, status: 200, ...(await signupGuard()) };
}

// Call inside the sign-up transaction, before the account is created. true = this network is over the limit.
// The lock on the network key makes two sign-ups at the same moment count one after the other, on any server.
export async function overLimit(c, net) {
  if (!net) return false;
  const g = await signupGuard();
  if (!g.on) return false;
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`signup:${net}`]);
  const r = await c.query("SELECT count(*) AS n FROM users WHERE data->>'netKey' = $1 AND (data->>'createdAt')::bigint > $2", [net, Date.now() - DAY_MS]);
  return Number(r.rows[0].n) >= g.perDay;
}
