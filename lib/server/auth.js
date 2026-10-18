// Accounts and sessions. Storage lives in lib/server/db.js (users keep email, pw, createdAt on their record).
// An email account's id is its lowercase email, which is also what the referral list masks (a***@mail.com).
// Sessions are a signed, httpOnly cookie. The signing key is SESSION_SECRET, or a random key saved with the data.
// Until REQUIRE_AUTH=1 is set, a request with no valid session is served the demo user (the "Skip login" button).
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
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

// A session carries the account's pwAt (0 until the password is first changed). Changing or resetting the password
// sets pwAt, so every older session stops matching and that account is signed out everywhere else.
export function newSession(id) {
  const v = store.users.get(id)?.pwAt || 0;
  const body = `${Buffer.from(id).toString('base64url')}.${Date.now() + MAX_AGE * 1000}.${v}`;
  return `${body}.${mac(body)}`;
}

function readSession(token) {
  const p = String(token || '').split('.');
  if (p.length !== 3 && p.length !== 4) return null;
  const old = p.length === 3; // issued before password change existed: id.expiry.signature
  const [b, exp, v, sig] = old ? [p[0], p[1], '0', p[2]] : p;
  const body = old ? `${b}.${exp}` : `${b}.${exp}.${v}`;
  if (!b || !exp || !sig || !eq(sig, mac(body)) || Number(exp) < Date.now()) return null;
  const id = Buffer.from(b, 'base64url').toString();
  const u = store.users.get(id);
  return u && String(u.pwAt || 0) === v ? id : null;
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

// Password change (signed in) and reset (emailed link). Both set pwAt, so the route then issues a fresh cookie.
// Reset emails go out through Resend: set RESEND_API_KEY and MAIL_FROM (for example "Opus <no-reply@yourdomain>").
const setPw = (u, pw) => {
  const salt = randomBytes(16).toString('hex');
  u.pw = { salt, hash: hashPw(pw, salt) };
  u.pwAt = Date.now();
  delete u.reset;
};

export function changePassword(id, input) {
  const u = id && id !== 'demo' ? store.users.get(id) : null;
  if (!u?.pw) return fail(403, 'This account has no password to change.');
  const cur = String(input?.current ?? '').slice(0, 200);
  const next = String(input?.password ?? '');
  if (!eq(hashPw(cur, u.pw.salt), u.pw.hash)) return fail(422, 'Current password is wrong.', 'current');
  if (next.length < 8 || next.length > 200) return fail(422, 'New password needs at least 8 characters.', 'password');
  if (next === cur) return fail(422, 'Choose a different password.', 'password');
  setPw(u, next);
  notify(u, { kind: 'news', title: 'Password changed', body: 'Other devices were signed out.' });
  return { ok: true, status: 200, id };
}

export const mailEnabled = () => !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
const sha = (s) => createHash('sha256').update(s).digest('hex');
const RESET_MS = 30 * 60_000;

async function sendMail(to, subject, text) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, text }),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`mail provider answered ${r.status}`);
}

// Emails a reset link (valid 30 minutes, one per minute per account). The answer is the same whether or not the
// email has an account, and the mail is not awaited, so neither the reply nor its timing reveals which emails exist.
export function requestReset(input, baseUrl) {
  if (!mailEnabled()) return fail(503, 'Password reset by email is not set up yet.');
  const id = normEmail(input?.email);
  if (!id) return fail(422, 'Enter a valid email address.', 'email');
  const u = store.users.get(id);
  if (u?.pw && !(u.reset && Date.now() - u.reset.at < 60_000)) {
    const token = randomBytes(24).toString('base64url');
    u.reset = { h: sha(token), exp: Date.now() + RESET_MS, at: Date.now() };
    const url = `${baseUrl}/login?reset=${token}&email=${encodeURIComponent(id)}`;
    sendMail(
      id,
      'Reset your Opus password',
      `Someone asked to reset the password for your Opus account.\n\nOpen this link within 30 minutes to choose a new password:\n${url}\n\nIf this was not you, ignore this email. Your password stays the same.`,
    ).catch((e) => console.error('[auth] reset email failed:', e.message));
  }
  return { ok: true, status: 200 };
}

export function confirmReset(input) {
  const id = normEmail(input?.email);
  const u = id ? store.users.get(id) : null;
  const pw = String(input?.password ?? '');
  if (pw.length < 8 || pw.length > 200) return fail(422, 'Password needs at least 8 characters.', 'password');
  const t = u?.reset;
  if (!t || t.exp < Date.now() || !eq(sha(String(input?.token ?? '').slice(0, 100)), t.h)) {
    return fail(400, 'This reset link is invalid or has expired. Request a new one.');
  }
  setPw(u, pw);
  notify(u, { kind: 'news', title: 'Password reset', body: 'Your password was reset from an email link.' });
  return { ok: true, status: 200, id };
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
