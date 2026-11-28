// Phone notices for the Android app (Firebase Cloud Messaging, HTTP v1 API). Every in-app notification (db.js notify()) also goes to the
// phones the account registered (u.push = [{ t: token, lang, at }], POST /api/push), in the language the phone sent. Tapping it opens
// /notifications.
// FCM_SERVICE_ACCOUNT empty = switched off. The value is the Firebase service account key: the JSON itself or its base64.
// Sent after COMMIT like the Telegram jobs (db.js tx()): nothing here may throw into a request, and nothing waits inside a transaction.
// A token Firebase says is dead (app removed, data cleared) is deleted, so it is not tried again.
import { createSign } from 'node:crypto';
import { pickLang, translate } from '@/lib/i18n/langs';
import { noteTitle, noteBody } from '@/lib/i18n/notes';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
export const MAX_TOKENS = 5; // phones per account; the oldest is dropped
export const OPEN_PATH = '/notifications';

// { projectId, email, key } when switched on, else null.
export function fcmConfig(env = process.env) {
  const raw = String(env.FCM_SERVICE_ACCOUNT || '').trim();
  if (!raw) return null;
  let j = null;
  for (const text of [raw, Buffer.from(raw, 'base64').toString('utf8')]) {
    try {
      j = JSON.parse(text);
      break;
    } catch {}
  }
  if (!j || typeof j.project_id !== 'string' || typeof j.client_email !== 'string' || typeof j.private_key !== 'string') return null;
  return { projectId: j.project_id, email: j.client_email, key: j.private_key };
}

// A Firebase token as the app sends it: printable, no spaces, 20 to 4096 characters.
export const validToken = (t) => typeof t === 'string' && /^[\x21-\x7e]{20,4096}$/.test(t);

const b64url = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

// The signed request for a Google access token (service account, RS256).
export function signedJwt(cfg, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const head = b64url({ alg: 'RS256', typ: 'JWT' });
  const claim = b64url({ iss: cfg.email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 });
  const sig = createSign('RSA-SHA256').update(`${head}.${claim}`).sign(cfg.key).toString('base64url');
  return `${head}.${claim}.${sig}`;
}

const g = (globalThis.__vtxPush ||= { token: null, exp: 0, inflight: null });

async function accessToken(cfg, fetchFn) {
  if (g.token && Date.now() < g.exp - 60_000) return g.token;
  g.inflight ||= (async () => {
    try {
      const r = await fetchFn(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signedJwt(cfg) }),
        signal: AbortSignal.timeout(10_000),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || typeof j.access_token !== 'string') throw new Error(`token ${r.status}`);
      g.token = j.access_token;
      g.exp = Date.now() + (Number(j.expires_in) || 3600) * 1000;
      return g.token;
    } finally {
      g.inflight = null;
    }
  })();
  return g.inflight;
}

// The text of one notification in one language (the same words as the bell list).
export function pushText(note, lang) {
  const l = pickLang(lang);
  const t = (k, v) => translate(l, k, v);
  const title = String(noteTitle(note, t, l) || 'Vertexhash').slice(0, 120);
  const body = String(noteBody(note, t, l) || '').slice(0, 400);
  return { title, body };
}

// The FCM message for one phone. tag = the notification id, so a repeat replaces the shown one instead of adding a second.
export function fcmMessage(token, note, lang) {
  const { title, body } = pushText(note, lang);
  return {
    message: {
      token,
      notification: { title, body },
      data: { url: OPEN_PATH, id: String(note.id || '') },
      android: { priority: 'high', notification: { tag: String(note.id || 'vtx').slice(0, 64), color: '#F5A623' } },
    },
  };
}

// Firebase answers 404 (UNREGISTERED) or 400 with a bad token when the phone no longer has the app: that token is dead.
export const deadToken = (status, j) => {
  const code = j?.error?.status || j?.error?.details?.find?.((d) => d?.errorCode)?.errorCode || '';
  return status === 404 || code === 'UNREGISTERED' || (status === 400 && /registration token|INVALID_ARGUMENT/i.test(`${code} ${j?.error?.message || ''}`));
};

// The account's phones, newest first (u.push, at most MAX_TOKENS).
export const phonesOf = (u) => (Array.isArray(u?.push) ? u.push.filter((p) => p && validToken(p.t)) : []);

// The list with one phone added (or moved to the top with its new language), oldest dropped past MAX_TOKENS.
export function withPhone(u, token, lang) {
  return [{ t: token, lang: pickLang(lang), at: Date.now() }, ...phonesOf(u).filter((p) => p.t !== token)].slice(0, MAX_TOKENS);
}

export const withoutPhones = (u, tokens) => phonesOf(u).filter((p) => !tokens.includes(p.t));

export const MAX_SENDS = 10; // sends in flight on this server, shared by every call
const lane = (globalThis.__vtxPushLane ||= { active: 0, waiting: [] });

async function limited(fn) {
  if (lane.active >= MAX_SENDS) await new Promise((r) => lane.waiting.push(r)); // the finishing send hands its place over
  else lane.active += 1;
  try {
    return await fn();
  } finally {
    const next = lane.waiting.shift();
    if (next) next();
    else lane.active -= 1;
  }
}

// jobs: [{ userId, note, phones }] from db.js notify(). drop(userId, tokens) forgets dead phones. Never throws.
export async function sendPushJobs(jobs, { drop, env = process.env, fetchFn = fetch } = {}) {
  try {
    const cfg = fcmConfig(env);
    const sends = jobs.flatMap((j) => (j.phones || []).map((p) => ({ userId: j.userId, p, note: j.note })));
    if (!cfg || !sends.length) return;
    const bearer = await accessToken(cfg, fetchFn);
    const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(cfg.projectId)}/messages:send`;
    const dead = new Map(); // userId -> dead tokens
    // A few at a time, counted across all calls: many broadcasts must not open hundreds of connections at once.
    await Promise.all(
      sends.map(({ userId, p, note }) =>
        limited(async () => {
          if (dead.get(userId)?.includes(p.t)) return;
          try {
            const res = await fetchFn(url, {
              method: 'POST',
              headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
              body: JSON.stringify(fcmMessage(p.t, note, p.lang)),
              signal: AbortSignal.timeout(10_000),
            });
            if (res.ok) return;
            const j = await res.json().catch(() => ({}));
            if (deadToken(res.status, j)) dead.set(userId, [...(dead.get(userId) || []), p.t]);
            else console.error('[push] send failed:', res.status, j?.error?.status || '');
          } catch (e) {
            console.error('[push] send error:', e.message);
          }
        }),
      ),
    );
    if (drop) for (const [userId, tokens] of dead) await drop(userId, tokens).catch((e) => console.error('[push] drop:', e.message));
  } catch (e) {
    console.error('[push]', e.message);
  }
}
