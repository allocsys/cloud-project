// Calls from the Telegram bot service to the app (POST /api/bot/<name>). Only the bot may call: the body is signed the same way
// as the app's own notifications (hex HMAC-SHA512 of the JSON with keys sorted recursively, header x-app-sig, secret APP_BOT_SECRET)
// and carries sent_at (ISO time, 10 min window). The routes only read, except /link (it links an email account to a Telegram id). APP_BOT_SECRET empty or short = switched off (503).
import { timingSafeEqual } from 'node:crypto';
import { signBody } from '@/lib/server/botnotify';
import { q } from '@/lib/server/db';
import { getRefCtx, summaryOf, vipViewOf, codeOf } from '@/lib/server/referrals';
import { getDashboard } from '@/lib/server/account';
import { availableOf } from '@/lib/server/wallet';
import { lockedBtc } from '@/lib/deposit-hold';
import { pricesFor } from '@/lib/server/prices';
import { botLinkClaim } from '@/lib/server/botlink';

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
const round2 = (n) => Math.round(n * 100) / 100;

// The account of a call: an email account linked to this Telegram id (see /link) wins, else { id: 'tg:<id>' }.
// { err: { status, json } } for a bad id (400) or no account (404). Nothing is created.
async function tgAccount(body) {
  const tg = body?.tg_id;
  if (!Number.isSafeInteger(tg) || tg <= 0) return { err: { status: 400, json: { ok: false, error: 'Bad tg_id.' } } };
  const linked = await q("SELECT id FROM users WHERE data->>'botTg' = $1 LIMIT 1", [String(tg)]);
  if (linked.rowCount) return { id: linked.rows[0].id };
  const id = `tg:${tg}`;
  if (!(await q('SELECT 1 FROM users WHERE id = $1', [id])).rowCount) return { err: { status: 404, json: { ok: false, error: 'No account.' } } };
  return { id };
}

// What /balance shows for a Telegram account: balance in BTC (never below 0), the part still locked by the deposit hold,
// and the USD value at the real price (null when no real price is known: never a made-up number).
export async function balanceFor(body) {
  const a = await tgAccount(body);
  if (a.err) return a.err;
  const ctx = await getRefCtx(a.id);
  const btc = Math.max(0, availableOf(ctx));
  const locked = Math.min(btc, lockedBtc(ctx.u));
  const pr = await pricesFor(['btc']);
  const usd = pr.ok ? Math.round(btc * pr.prices.btc * 100) / 100 : null;
  return { status: 200, json: { ok: true, btc: round8(btc), locked: round8(locked), usd } };
}

// What /earnings shows: the same numbers as the Earnings page. miners = the account has any miner; today = BTC earned so far today;
// total = BTC earned since the first miner; avgUsd = USD per day over the last 7 live days.
export async function earningsFor(body) {
  const a = await tgAccount(body);
  if (a.err) return a.err;
  const d = await getDashboard(a.id);
  return { status: 200, json: { ok: true, miners: !!d.hasMiners, today: round8(Math.max(0, d.todayBtc)), total: round8(Math.max(0, d.totalBtc)), avgUsd: round2(Math.max(0, d.avgUsd)) } };
}

// What /referrals shows: the default invite code, friends (all and active), BTC earned from them (after rebates, as on the Referrals page) and the VIP level.
export async function referralsFor(body) {
  const a = await tgAccount(body);
  if (a.err) return a.err;
  const ctx = await getRefCtx(a.id);
  const s = summaryOf(ctx);
  return {
    status: 200,
    json: {
      ok: true,
      code: codeOf(ctx.u),
      friends: s.friends.length,
      active: s.friends.filter((f) => f.status === 'active').length,
      earned: round8(Math.max(0, s.earnedBtcNum)),
      vip: vipViewOf(ctx).level,
    },
  };
}

// What /link does: links the email account that made the code to this Telegram id. 400 bad tg_id or code, 404 code not valid (wrong, used
// or expired: one answer), 403 this Telegram already has its own account, 409 Telegram already linked, 429 too many tries.
// A good link answers with the masked email (m***@gmail.com) for the bot to show.
export async function linkFor(body) {
  const tg = body?.tg_id;
  if (!Number.isSafeInteger(tg) || tg <= 0) return { status: 400, json: { ok: false, error: 'Bad tg_id.' } };
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  if (code.length < 3 || code.length > 32) return { status: 400, json: { ok: false, error: 'Bad code.' } };
  const r = await botLinkClaim(tg, code);
  return { status: r.status, json: r.ok ? { ok: true, email: r.email } : { ok: false, error: r.error } };
}
