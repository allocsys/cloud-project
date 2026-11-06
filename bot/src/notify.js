// The app tells the bot to send a message: POST /notify. Signed like the gateway callbacks:
// hex HMAC-SHA512 of the JSON body with its keys sorted recursively, header x-app-sig, secret APP_BOT_SECRET.
// sent_at (ISO time) is inside the signed body so an old copy cannot be replayed. The app uses the same signBody (2B).
import { createHmac } from 'node:crypto';
import { safeEqual } from './util.js';
import { texts } from './texts.js';

export const SENT_AT_WINDOW_MS = 10 * 60_000;
export const MAX_PENDING = 20_000;

const sortDeep = (v) =>
  Array.isArray(v)
    ? v.map(sortDeep)
    : v && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])]))
      : v;

export const signBody = (payload, secret) => createHmac('sha512', secret).update(JSON.stringify(sortDeep(payload))).digest('hex');

// Returns the parsed body when the signature and sent_at are good, else null.
export function verifySig(raw, sig, secret, now = Date.now()) {
  const got = String(sig || '').trim().toLowerCase();
  if (!secret || !got) return null;
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  if (!safeEqual(signBody(body, secret), got)) return null;
  const at = typeof body.sent_at === 'string' ? Date.parse(body.sent_at) : NaN;
  if (!Number.isFinite(at) || Math.abs(now - at) > SENT_AT_WINDOW_MS) return null;
  return body;
}

// A kind is known when its English text n_<kind> exists in texts.js.
export const kindKnown = (k) => typeof k === 'string' && /^[a-z][a-z0-9_]{0,31}$/.test(k) && !!texts.en['n_' + k];

// Checks the body fields. { ok: true, value } or { ok: false, error }.
export function parseNotify(b) {
  if (!Number.isSafeInteger(b.tg_id) || b.tg_id <= 0) return { ok: false, error: 'Bad tg_id.' };
  if (!kindKnown(b.kind)) return { ok: false, error: 'Unknown kind.' };
  if (typeof b.key !== 'string' || !/^[A-Za-z0-9:_.-]{8,128}$/.test(b.key)) return { ok: false, error: 'Bad key.' };
  if (b.lang !== undefined && b.lang !== 'en' && b.lang !== 'fa') return { ok: false, error: 'Bad lang.' };
  const vars = {};
  if (b.vars !== undefined) {
    if (!b.vars || typeof b.vars !== 'object' || Array.isArray(b.vars)) return { ok: false, error: 'Bad vars.' };
    const keys = Object.keys(b.vars);
    if (keys.length > 10) return { ok: false, error: 'Too many vars.' };
    for (const k of keys) {
      const v = b.vars[k];
      const good = (typeof v === 'string' && v.length <= 200) || (typeof v === 'number' && Number.isFinite(v));
      if (!/^\w{1,32}$/.test(k) || !good) return { ok: false, error: 'Bad vars.' };
      vars[k] = v;
    }
  }
  return { ok: true, value: { tg_id: b.tg_id, kind: b.kind, key: b.key, lang: b.lang || null, vars } };
}
