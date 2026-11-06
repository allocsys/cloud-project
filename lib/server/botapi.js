// Calls from the Telegram bot service to the app (POST /api/bot/<name>). Only the bot may call: the body is signed the same way
// as the app's own notifications (hex HMAC-SHA512 of the JSON with keys sorted recursively, header x-app-sig, secret APP_BOT_SECRET)
// and carries sent_at (ISO time, 10 min window). The routes are read-only. APP_BOT_SECRET empty or short = switched off (503).
import { timingSafeEqual } from 'node:crypto';
import { signBody } from '@/lib/server/botnotify';
import { q } from '@/lib/server/db';
import { getRefCtx } from '@/lib/server/referrals';
import { availableOf } from '@/lib/server/wallet';
import { lockedBtc } from '@/lib/deposit-hold';
import { pricesFor } from '@/lib/server/prices';

export const SENT_AT_WINDOW_MS = 10 * 60_000;
export const MAX_BODY = 4096;

const same = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

// The parsed body when the signature and sent_at are good, else null.
export function verifyCall(raw, sig, secret, now = Date.now()) {
  const got = String(sig || '').trim().toLowerCase();
  if (!secret || !got) return null;
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  if (!same(signBody(body, secret), got)) return null;
  const at = typeof body.sent_at === 'string' ? Date.parse(body.sent_at) : NaN;
  if (!Number.isFinite(at) || Math.abs(now - at) > SENT_AT_WINDOW_MS) return null;
  return body;
}

// Checks the call, then runs fn(body). Returns { status, json }; never throws for a bad call.
export async function serve(raw, sig, fn, { env = process.env, now } = {}) {
  const secret = String(env.APP_BOT_SECRET || '');
  if (secret.length < 16) return { status: 503, json: { ok: false, error: 'Off.' } };
  const body = verifyCall(raw, sig, secret, now);
  if (!body) return { status: 401, json: { ok: false, error: 'Bad signature.' } };
  return fn(body);
}

const round8 = (n) => Math.round(n * 1e8) / 1e8;

// What /balance shows for a Telegram account: balance in BTC (never below 0), the part still locked by the deposit hold,
// and the USD value at the real price (null when no real price is known: never a made-up number).
export async function balanceFor(body) {
  const tg = body?.tg_id;
  if (!Number.isSafeInteger(tg) || tg <= 0) return { status: 400, json: { ok: false, error: 'Bad tg_id.' } };
  const id = `tg:${tg}`;
  if (!(await q('SELECT 1 FROM users WHERE id = $1', [id])).rowCount) return { status: 404, json: { ok: false, error: 'No account.' } };
  const ctx = await getRefCtx(id);
  const btc = Math.max(0, availableOf(ctx));
  const locked = Math.min(btc, lockedBtc(ctx.u));
  const pr = await pricesFor(['btc']);
  const usd = pr.ok ? Math.round(btc * pr.prices.btc * 100) / 100 : null;
  return { status: 200, json: { ok: true, btc: round8(btc), locked: round8(locked), usd } };
}
