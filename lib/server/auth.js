// Accounts and sessions. Storage lives in lib/server/db.js (users keep email, pw, createdAt on their record).
// An email account's id is its lowercase email, which is also what the referral list masks (a***@mail.com).
// Sessions are a signed, httpOnly cookie. The signing key is SESSION_SECRET, or a random key saved with the data.
// Until REQUIRE_AUTH=1 is set, a request with no valid session is served the demo user (the "Skip login" button).
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { store, userOf, notify } from '@/lib/server/db';
import { link } from '@/lib/server/referrals';

export const COOKIE = 'opus_session';
export const MAX_AGE = 30 * 24 * 3600; // seconds

const secret = () => process.env.SESSION_SECRET || (store.authKey ||= randomBytes(32).toString('hex'));
const mac = (s) => createHmac('sha256', secret()).update(s).digest('base64url');
const eq = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};
const hashPw = (pw, salt) => scryptSync(String(pw), salt, 32).toString('hex');
const DUMMY_SALT = randomBytes(16).toString('hex'); // so an unknown email costs the same time as a wrong password

export function newSession(id) {
  const body = `${Buffer.from(id).toString('base64url')}.${Date.now() + MAX_AGE * 1000}`;
  return `${body}.${mac(body)}`;
}

function readSession(token) {
  const [b, exp, sig] = String(token || '').split('.');
  if (!b || !exp || !sig || !eq(sig, mac(`${b}.${exp}`)) || Number(exp) < Date.now()) return null;
  const id = Buffer.from(b, 'base64url').toString();
  return store.users.has(id) ? id : null;
}

export function setSession(res, id) {
  res.cookies.set(COOKIE, newSession(id), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE,
  });
  return res;
}

export function clearSession(res) {
  res.cookies.set(COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  return res;
}

// Who is calling. A valid session gives that user; otherwise the demo user, or null once REQUIRE_AUTH=1.
export function userId(req) {
  const id = readSession(req.cookies.get(COOKIE)?.value);
  if (id) return id;
  return process.env.REQUIRE_AUTH === '1' ? null : 'demo';
}

export const unauthorized = () =>
  NextResponse.json({ ok: false, error: 'Sign in required.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });

const normEmail = (v) => {
  const e = String(v ?? '').trim().toLowerCase();
  return e.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
};
const fail = (status, error, field) => ({ ok: false, status, error, field });

export function signup(input) {
  const id = normEmail(input?.email);
  const pw = String(input?.password ?? '');
  if (!id) return fail(422, 'Enter a valid email address.', 'email');
  if (pw.length < 8 || pw.length > 200) return fail(422, 'Password needs at least 8 characters.', 'password');
  if (store.users.has(id)) return fail(409, 'An account with this email already exists. Sign in instead.', 'email');

  // No awaits from here on, so two sign-ups with the same email cannot both pass the check above.
  const u = userOf(id);
  const salt = randomBytes(16).toString('hex');
  u.email = id;
  u.pw = { salt, hash: hashPw(pw, salt) };
  u.createdAt = Date.now();
  notify(u, { kind: 'news', title: 'Welcome to Opus', body: 'Your account is ready. Pick a plan to start mining.' });

  // A wrong invite code never blocks the sign-up.
  const code = String(input?.ref ?? '').trim().slice(0, 24);
  const ref = code ? (link(id, code).ok ? 'applied' : 'invalid') : null;
  return { ok: true, status: 200, id, ref };
}

export function login(input) {
  const id = normEmail(input?.email);
  const u = id ? store.users.get(id) : null;
  const pw = String(input?.password ?? '').slice(0, 200);
  const hash = hashPw(pw, u?.pw?.salt || DUMMY_SALT);
  if (!u?.pw || !eq(hash, u.pw.hash)) return fail(401, 'Wrong email or password.');
  return { ok: true, status: 200, id };
}

// Telegram Mini App sign-in. `initData` is what Telegram hands the page (window.Telegram.WebApp.initData), signed with
// the bot token (TELEGRAM_BOT_TOKEN). Account id is tg:<telegram id>; there is no password.
export const telegramEnabled = () => !!process.env.TELEGRAM_BOT_TOKEN;

export function telegramLogin(initData, refCode) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return fail(503, 'Telegram sign-in is not set up yet.');
  const params = new URLSearchParams(String(initData ?? '').slice(0, 4096));
  const hash = params.get('hash');
  params.delete('hash');
  const check = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const key = createHmac('sha256', 'WebAppData').update(token).digest();
  const calc = createHmac('sha256', key).update(check).digest('hex');
  if (!hash || !eq(calc, hash)) return fail(401, 'Telegram sign-in could not be verified.');
  const age = Date.now() / 1000 - Number(params.get('auth_date'));
  if (!(age > -60 && age < 86400)) return fail(401, 'Telegram sign-in expired. Close and reopen the app, then try again.');
  let tg = null;
  try {
    tg = JSON.parse(params.get('user') || '');
  } catch {}
  if (!tg || !Number.isSafeInteger(tg.id)) return fail(401, 'Telegram sign-in could not be verified.');

  const id = `tg:${tg.id}`;
  const isNew = !store.users.has(id);
  const u = userOf(id);
  let ref = null;
  if (isNew) {
    u.createdAt = Date.now();
    u.tgName = [tg.first_name, tg.last_name].filter(Boolean).join(' ').slice(0, 60) || tg.username || null;
    notify(u, { kind: 'news', title: 'Welcome to Opus', body: 'Your account is ready. Pick a plan to start mining.' });
    const code = String(refCode ?? '').trim().slice(0, 24);
    ref = code ? (link(id, code).ok ? 'applied' : 'invalid') : null;
  }
  return { ok: true, status: 200, id, ref };
}

// Eight wrong attempts for one address and email lock that pair for 15 minutes.
const tries = (globalThis.__authTries ||= new Map());
export const clientIp = (req) => (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
export const throttled = (k) => {
  const t = tries.get(k);
  return !!t && t.n >= 8 && Date.now() < t.until;
};
export function noteFail(k) {
  const now = Date.now();
  const t = tries.get(k);
  if (!t || now > t.until) tries.set(k, { n: 1, until: now + 15 * 60_000 });
  else t.n += 1;
  if (tries.size > 500) tries.clear();
}
export const clearFails = (k) => tries.delete(k);

// What the app needs to know about the signed-in user.
export function whoami(id) {
  const u = store.users.get(id);
  return { id, email: u?.email || null, name: u?.tgName || null, telegram: id.startsWith('tg:'), demo: id === 'demo', telegramLogin: telegramEnabled() };
}
