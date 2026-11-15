// Account farming guard: one network (the keyed /24 or /64 hash from netKeyOf in auth.js) can have only a set number of accounts in total.
// Email and Telegram sign-ups both count, closed accounts too (they keep netKey). Opening an existing account is never limited.
// An unknown address (no netKey) is never limited. Settings live in the meta entry "signupguard". Admin > Settings > Sign-up limit.
//   on   true (the default) = the limit is enforced; false = off.
//   max  accounts one network may have in total. Default 3, from 1 to 50.
import { warm, metaGet, metaUpdate } from '@/lib/server/db';

export const SIGNUP_LIMIT = { def: 3, min: 1, max: 50 };
export const LIMIT_MSG = 'Account limit reached for this network.';

export async function signupGuard() {
  await warm();
  const s = metaGet('signupguard') || {};
  const n = Math.floor(Number(s.max));
  return { on: s.on !== false, max: n >= SIGNUP_LIMIT.min && n <= SIGNUP_LIMIT.max ? n : SIGNUP_LIMIT.def };
}

// input: { enabled?: boolean, max?: number }. Only what is given changes.
export async function saveSignupGuard(input) {
  const next = {};
  if (input?.enabled !== undefined) {
    if (typeof input.enabled !== 'boolean') return { ok: false, status: 400, error: 'Choose on or off.' };
    next.on = input.enabled;
  }
  if (input?.max !== undefined && String(input.max).trim() !== '') {
    const n = Number(String(input.max).trim().replace(',', '.'));
    if (!Number.isInteger(n) || n < SIGNUP_LIMIT.min || n > SIGNUP_LIMIT.max) return { ok: false, status: 422, error: `Enter a whole number from ${SIGNUP_LIMIT.min} to ${SIGNUP_LIMIT.max}.` };
    next.max = n;
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
  const r = await c.query("SELECT count(*) AS n FROM users WHERE data->>'netKey' = $1", [net]);
  return Number(r.rows[0].n) >= g.max;
}
