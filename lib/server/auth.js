// Accounts and sessions. Storage lives in lib/server/db.js (users keep email, pw, createdAt on their record).
// An email account's id is its lowercase email, which is also what the referral list masks (a***@mail.com).
// Sessions are a signed, httpOnly cookie. The signing key is SESSION_SECRET, or a random key kept in the database,
// so every server signs and checks sessions the same way.
// Until REQUIRE_AUTH=1 is set, a request with no valid session is served the demo user (the "Skip login" button).
import { createHash, createHmac, randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { NextResponse } from 'next/server';
import { MIN_WITHDRAW } from '@/lib/data';
import { pool, q, tx, warm, metaGet, hydrate, createUser, saveUser, withUser, notify, throttled as dbThrottled, noteFail as dbNoteFail, clearFails as dbClearFails } from '@/lib/server/db';
import { assignCode, applyLink } from '@/lib/server/referrals';
import { availableIn } from '@/lib/server/wallet';
import * as totp from '@/lib/server/totp';

export const COOKIE = 'opus_session';
export const MAX_AGE = 30 * 24 * 3600; // seconds

const scrypt = promisify(scryptCb);

const secret = () => {
  const s = process.env.SESSION_SECRET || metaGet('authkey');
  if (!s) throw new Error('No session key available (database not ready).');
  return s;
};
const mac = (s) => createHmac('sha256', secret()).update(s).digest('base64url');
const eq = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};
// Async, so a burst of sign-ins does not block the server's other requests while it hashes.
const hashPw = async (pw, salt) => (await scrypt(String(pw), salt, 32)).toString('hex');
const DUMMY_SALT = randomBytes(16).toString('hex'); // so an unknown email costs the same time as a wrong password

const pwAtOf = async (id) => {
  const r = await q("SELECT data->>'pwAt' AS v FROM users WHERE id = $1", [id]);
  return r.rows[0] ? String(r.rows[0].v || 0) : null; // null: no such account
};

// A session carries the account's pwAt (0 until the password is first changed). Changing or resetting the password
// sets pwAt, so every older session stops matching and that account is signed out everywhere else.
export async function newSession(id) {
  await warm();
  const v = (await pwAtOf(id)) || '0';
  const body = `${Buffer.from(id).toString('base64url')}.${Date.now() + MAX_AGE * 1000}.${v}`;
  return `${body}.${mac(body)}`;
}

async function readSession(token) {
  const p = String(token || '').split('.');
  if (p.length !== 3 && p.length !== 4) return null;
  const old = p.length === 3; // issued before password change existed: id.expiry.signature
  const [b, exp, v, sig] = old ? [p[0], p[1], '0', p[2]] : p;
  await warm();
  const body = old ? `${b}.${exp}` : `${b}.${exp}.${v}`;
  if (!b || !exp || !sig || !eq(sig, mac(body)) || Number(exp) < Date.now()) return null;
  const id = Buffer.from(b, 'base64url').toString();
  return (await pwAtOf(id)) === v ? id : null;
}

export async function setSession(res, id) {
  res.cookies.set(COOKIE, await newSession(id), {
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
export async function userId(req) {
  const token = req.cookies.get(COOKIE)?.value;
  const id = token ? await readSession(token) : null;
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
// An email belongs to one account: an email account (id = email) or a Telegram account that added it (data.email).
const emailTaken = async (email) => (await q("SELECT 1 FROM users WHERE id = $1 OR data->>'email' = $1 LIMIT 1", [email])).rowCount > 0;
const uidOfEmail = async (email) => (await q("SELECT id FROM users WHERE id = $1 OR data->>'email' = $1 LIMIT 1", [email])).rows[0]?.id || null;

export async function signup(input) {
  const id = normEmail(input?.email);
  const pw = String(input?.password ?? '');
  if (!id) return fail(422, 'Enter a valid email address.', 'email');
  if (pw.length < 8 || pw.length > 200) return fail(422, 'Password needs at least 8 characters.', 'password');
  if (await emailTaken(id)) return fail(409, 'An account with this email already exists. Sign in instead.', 'email');

  const salt = randomBytes(16).toString('hex');
  const hash = await hashPw(pw, salt);
  const code = String(input?.ref ?? '').trim().slice(0, 24);
  let ref = null;

  // The insert itself is the uniqueness check, so two sign-ups with the same email cannot both succeed, on any server.
  const created = await tx(async (c) => {
    const u = await createUser(c, id, { email: id, pw: { salt, hash } });
    if (!u) return false;
    await assignCode(c, u);
    notify(u, { kind: 'news', title: 'Welcome to Opus', body: 'Your account is ready. Pick a plan to start mining.' });
    // A wrong invite code never blocks the sign-up.
    ref = code ? ((await applyLink(c, u, code)).ok ? 'applied' : 'invalid') : null;
    await saveUser(c, u);
    return true;
  });
  if (!created) return fail(409, 'An account with this email already exists. Sign in instead.', 'email');
  return { ok: true, status: 200, id, ref };
}

export async function login(input) {
  const id = normEmail(input?.email);
  const pw = String(input?.password ?? '').slice(0, 200);
  const row = id ? (await q("SELECT id AS uid, data->'pw' AS pw, (data->'twofa') IS NOT NULL AS tf FROM users WHERE id = $1 OR data->>'email' = $1 LIMIT 1", [id])).rows[0] : null;
  const saved = row?.pw || null;
  const hash = await hashPw(pw, saved?.salt || DUMMY_SALT);
  if (!saved || !eq(hash, saved.hash)) return fail(401, 'Wrong email or password.');
  // Right password. With two-factor on, a code is the second step: asking for it is not a failure (need2fa), a wrong one is.
  if (row.tf) {
    const code = String(input?.code ?? '').trim();
    if (!code) return { ...fail(401, NEED_CODE, 'code'), need2fa: true };
    const r = await withUser(row.uid, (u) => (!u?.twofa || useSecondFactor(u, code) ? { ok: true, status: 200 } : fail(401, WRONG_CODE, 'code')));
    if (!r.ok) return r;
  }
  return { ok: true, status: 200, id: row.uid }; // a Telegram account that added an email signs in with it, under its own id
}

// Telegram Mini App sign-in. `initData` is what Telegram hands the page (window.Telegram.WebApp.initData), signed with
// the bot token (TELEGRAM_BOT_TOKEN). Account id is tg:<telegram id>; there is no password.
export const telegramEnabled = () => !!process.env.TELEGRAM_BOT_TOKEN;

export async function telegramLogin(initData, refCode) {
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
  const tgName = [tg.first_name, tg.last_name].filter(Boolean).join(' ').slice(0, 60) || tg.username || null;
  const code = String(refCode ?? '').trim().slice(0, 24);
  let ref = null;
  await tx(async (c) => {
    const u = await createUser(c, id, { tgName });
    if (!u) return; // already has an account: just sign in
    await assignCode(c, u);
    notify(u, { kind: 'news', title: 'Welcome to Opus', body: 'Your account is ready. Pick a plan to start mining.' });
    ref = code ? ((await applyLink(c, u, code)).ok ? 'applied' : 'invalid') : null;
    await saveUser(c, u);
  });
  return { ok: true, status: 200, id, ref };
}

// Password change (signed in) and reset (emailed link). Both set pwAt, so the route then issues a fresh cookie.
// Reset emails go out through Resend: set RESEND_API_KEY and MAIL_FROM (for example "Opus <no-reply@yourdomain>").
const setPw = (u, salt, hash) => {
  u.pw = { salt, hash };
  u.pwAt = Date.now();
  delete u.reset;
};

export async function changePassword(id, input) {
  const row = id && id !== 'demo' ? (await q("SELECT data->'pw' AS pw FROM users WHERE id = $1", [id])).rows[0] : null;
  const old = row?.pw;
  if (!old) return fail(403, 'This account has no password to change.');
  const cur = String(input?.current ?? '').slice(0, 200);
  const next = String(input?.password ?? '');
  if (!eq(await hashPw(cur, old.salt), old.hash)) return fail(422, 'Current password is wrong.', 'current');
  if (next.length < 8 || next.length > 200) return fail(422, 'New password needs at least 8 characters.', 'password');
  if (next === cur) return fail(422, 'Choose a different password.', 'password');
  const salt = randomBytes(16).toString('hex');
  const hash = await hashPw(next, salt);
  return withUser(id, (u) => {
    if (!u?.pw || u.pw.hash !== old.hash) return fail(409, 'Your password changed while you were doing this. Try again.');
    setPw(u, salt, hash);
    notify(u, { kind: 'news', title: 'Password changed', body: 'Other devices were signed out.' });
    return { ok: true, status: 200, id };
  });
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
export async function requestReset(input, baseUrl) {
  if (!mailEnabled()) return fail(503, 'Password reset by email is not set up yet.');
  const id = normEmail(input?.email);
  if (!id) return fail(422, 'Enter a valid email address.', 'email');
  const token = randomBytes(24).toString('base64url');
  const uid = await uidOfEmail(id);
  const issued =
    uid &&
    (await withUser(uid, (u) => {
      if (!u?.pw || (u.reset && Date.now() - u.reset.at < 60_000)) return false;
      u.reset = { h: sha(token), exp: Date.now() + RESET_MS, at: Date.now() };
      return true;
    }));
  if (issued) {
    const url = `${baseUrl}/login?reset=${token}&email=${encodeURIComponent(id)}`;
    sendMail(
      id,
      'Reset your Miner Opus password',
      `Someone asked to reset the password for your Miner Opus account.\n\nOpen this link within 30 minutes to choose a new password:\n${url}\n\nIf this was not you, ignore this email. Your password stays the same.`,
    ).catch((e) => console.error('[auth] reset email failed:', e.message));
  }
  return { ok: true, status: 200 };
}

export async function confirmReset(input) {
  const id = normEmail(input?.email);
  const pw = String(input?.password ?? '');
  if (pw.length < 8 || pw.length > 200) return fail(422, 'Password needs at least 8 characters.', 'password');
  if (!id) return fail(400, 'This reset link is invalid or has expired. Request a new one.');
  const salt = randomBytes(16).toString('hex');
  const hash = await hashPw(pw, salt);
  const given = sha(String(input?.token ?? '').slice(0, 100));
  const uid = (await uidOfEmail(id)) || id;
  return withUser(uid, (u) => {
    const t = u?.reset;
    if (!t || t.exp < Date.now() || !eq(given, t.h)) return fail(400, 'This reset link is invalid or has expired. Request a new one.');
    // A reset link alone must not get past two-factor: the code is needed here too, and the link stays valid meanwhile.
    if (u.twofa) {
      const code = String(input?.code ?? '').trim();
      if (!code) return { ...fail(401, NEED_CODE, 'code'), need2fa: true };
      if (!useSecondFactor(u, code)) return fail(401, WRONG_CODE, 'code');
    }
    setPw(u, salt, hash);
    notify(u, { kind: 'news', title: 'Password reset', body: 'Your password was reset from an email link.' });
    return { ok: true, status: 200, id: uid };
  });
}

// Email verification: a link that proves the address is the user's (valid 24 hours, one per minute per account).
// Sent after sign-up and from Settings. It does not block anything yet; the account just shows as verified.
const VERIFY_MS = 24 * 3600_000;

export async function sendVerification(id, baseUrl) {
  if (!mailEnabled()) return fail(503, 'Email is not set up yet.');
  if (!id || !id.includes('@')) return fail(403, 'This account has no email address.');
  const token = randomBytes(24).toString('base64url');
  const state = await withUser(id, (u) => {
    if (!u?.email) return 'none';
    if (u.emailVerified) return 'done';
    if (u.emailVerify && Date.now() - u.emailVerify.at < 60_000) return 'wait';
    u.emailVerify = { h: sha(token), exp: Date.now() + VERIFY_MS, at: Date.now() };
    return 'sent';
  });
  if (state === 'done') return { ok: true, status: 200, verified: true };
  if (state === 'wait') return fail(429, 'A link was just sent. Wait a minute before asking again.');
  if (state !== 'sent') return fail(403, 'This account has no email address.');
  const url = `${baseUrl}/verify?token=${token}&email=${encodeURIComponent(id)}`;
  try {
    await sendMail(
      id,
      'Confirm your Miner Opus email',
      `Welcome to Miner Opus.\n\nOpen this link within 24 hours to confirm your email address:\n${url}\n\nIf you did not create a Miner Opus account, ignore this email.`,
    );
  } catch (e) {
    console.error('[auth] verification email failed:', e.message);
    return fail(502, 'Could not send the email. Try again later.');
  }
  return { ok: true, status: 200, verified: false };
}

export async function confirmVerify(input) {
  const id = normEmail(input?.email);
  if (!id) return fail(400, 'This link is invalid or has expired.');
  const given = sha(String(input?.token ?? '').slice(0, 100));
  return withUser(id, (u) => {
    const t = u?.emailVerify;
    if (!t || t.exp < Date.now() || !eq(given, t.h)) return fail(400, 'This link is invalid, expired or already used.');
    u.emailVerified = Date.now();
    delete u.emailVerify;
    return { ok: true, status: 200, id };
  });
}

// ---- Adding an email to a Telegram account ----
// A Telegram account (id tg:...) has no email. It can add one with a password: a 6-digit code goes to that inbox (15 minutes,
// 5 tries), and only the right code saves the email, the password and the verified mark on the SAME account, so balance,
// miners and invites stay put. After that the person can sign in with the email anywhere, and reset the password by email.
// Until the code is entered nothing but the pending request (u.emailAdd) is stored.
const ADD_MS = 15 * 60_000;
const ADD_TRIES = 5;
const onlyTelegram = (id) => (id && id.startsWith('tg:') ? null : fail(403, 'Only Telegram accounts can add an email.'));

export async function addEmailStart(id, input) {
  const no = onlyTelegram(id);
  if (no) return no;
  if (!mailEnabled()) return fail(503, 'Email is not set up yet.');
  const email = normEmail(input?.email);
  const pw = String(input?.password ?? '');
  if (!email) return fail(422, 'Enter a valid email address.', 'email');
  if (pw.length < 8 || pw.length > 200) return fail(422, 'Password needs at least 8 characters.', 'password');
  if (await emailTaken(email)) return fail(409, 'This email is already in use.', 'email');
  const salt = randomBytes(16).toString('hex');
  const hash = await hashPw(pw, salt);
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const state = await withUser(id, (u) => {
    if (!u) return 'none';
    if (u.email) return 'has';
    if (u.emailAdd && Date.now() - u.emailAdd.at < 60_000) return 'wait';
    u.emailAdd = { email, pw: { salt, hash }, h: sha(code), exp: Date.now() + ADD_MS, at: Date.now(), tries: 0 };
    return 'sent';
  });
  if (state === 'has') return fail(409, 'This account already has an email.');
  if (state === 'wait') return fail(429, 'A code was just sent. Wait a minute before asking again.');
  if (state !== 'sent') return fail(404, 'Account not found.');
  try {
    await sendMail(
      email,
      'Your Miner Opus code',
      `Your code to add this email to your Miner Opus account:\n\n${code}\n\nIt works for 15 minutes. If you did not ask for it, ignore this email.`,
    );
  } catch (e) {
    console.error('[auth] add-email code failed:', e.message);
    await withUser(id, (u) => {
      if (u) delete u.emailAdd;
    });
    return fail(502, 'Could not send the email. Try again later.');
  }
  return { ok: true, status: 200, email };
}

export async function addEmailConfirm(id, input) {
  const no = onlyTelegram(id);
  if (no) return no;
  const code = String(input?.code ?? '').replace(/\D/g, '');
  if (code.length !== 6) return fail(422, 'Enter the 6-digit code from the email.', 'code');
  try {
    return await withUser(id, async (u, c) => {
      if (!u) return fail(404, 'Account not found.');
      if (u.email) return fail(409, 'This account already has an email.');
      const p = u.emailAdd;
      if (!p || p.exp < Date.now()) return fail(409, 'The code expired. Ask for a new one.');
      if (p.tries >= ADD_TRIES) {
        delete u.emailAdd;
        return fail(429, 'Too many wrong codes. Ask for a new one.');
      }
      if (!eq(sha(code), p.h)) {
        p.tries += 1;
        return fail(422, 'That code is not right.', 'code');
      }
      const clash = await c.query("SELECT 1 FROM users WHERE (id = $1 OR data->>'email' = $1) AND id <> $2 LIMIT 1", [p.email, id]);
      if (clash.rowCount) {
        delete u.emailAdd;
        return fail(409, 'This email is already in use.', 'email');
      }
      u.email = p.email;
      u.pw = p.pw;
      u.pwAt = Date.now(); // older sessions stop matching; the route issues a fresh cookie
      u.emailVerified = Date.now();
      delete u.emailAdd;
      notify(u, { kind: 'news', title: 'Email added', body: 'You can now sign in with your email and password.' });
      return { ok: true, status: 200, id, email: u.email };
    });
  } catch (e) {
    if (e?.code === '23505') return fail(409, 'This email is already in use.', 'email'); // two accounts confirmed the same email at once
    throw e;
  }
}

// ---- Two-factor sign-in ----
// Optional, for email accounts. The person adds a key to an authenticator app, proves it works with a first code, and is
// given recovery codes (each works once). From then on sign-in and password reset also ask for a code. The key is kept in
// the account record (u.twofa) like the password hash is; `last` is the newest step already used, so a code works once.
const TF_PENDING_MS = 15 * 60_000;
const TF_RECOVERY = 10;
const NEED_CODE = 'Enter the 6-digit code from your authenticator app.';
const WRONG_CODE = 'That code is not right, or was already used. Wait for the next one and try again.';
const normCode = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const newRecoveryCode = () => {
  const t = totp.base32(randomBytes(10)).slice(0, 10);
  return `${t.slice(0, 5)}-${t.slice(5)}`;
};

// Tries a 6-digit app code or a recovery code against the account's second factor. Call it inside the account lock.
// Returns 'app', 'recovery' (that code is now used up) or null.
function useSecondFactor(u, input) {
  const t = u?.twofa;
  if (!t) return null;
  const typed = String(input ?? '').trim();
  if (/^\d{3}\s?\d{3}$/.test(typed)) {
    const step = totp.verify(t.secret, typed, { after: t.last || 0 });
    if (step === null) return null;
    t.last = step;
    return 'app';
  }
  const clean = normCode(typed);
  const i = clean.length === 10 ? (t.codes || []).indexOf(sha(clean)) : -1;
  if (i < 0) return null;
  t.codes.splice(i, 1);
  notify(u, { kind: 'news', title: 'Recovery code used', body: `${t.codes.length} left. Turn two-factor off and on again for a new set.` });
  return 'recovery';
}

const noTwofa = (id) => (!id || id === 'demo' ? fail(403, 'Sign in to your own account first.') : null);

// Step 1: a new key (not active yet) and the link authenticator apps open. Valid for 15 minutes.
export async function twofaStart(id) {
  const no = noTwofa(id);
  if (no) return no;
  const secret = totp.newSecret();
  return withUser(id, (u) => {
    if (!u) return fail(404, 'Account not found.');
    if (!u.pw || !u.email) return fail(403, 'Two-factor works with email and password accounts. This account signs in another way.');
    if (u.twofa) return fail(409, 'Two-factor is already on.');
    u.twofaPending = { secret, at: Date.now() };
    return { ok: true, status: 200, secret, uri: totp.otpauthUri(secret, u.email) };
  });
}

// Step 2: the first code from the app turns it on and returns the recovery codes. This is the only time they are shown.
export async function twofaEnable(id, input) {
  const no = noTwofa(id);
  if (no) return no;
  const codes = Array.from({ length: TF_RECOVERY }, newRecoveryCode);
  return withUser(id, (u) => {
    if (!u) return fail(404, 'Account not found.');
    if (u.twofa) return fail(409, 'Two-factor is already on.');
    const p = u.twofaPending;
    if (!p || Date.now() - p.at > TF_PENDING_MS) return fail(409, 'The setup key expired. Start again.');
    const step = totp.verify(p.secret, input?.code);
    if (step === null) return fail(422, 'That code is not right. Check the app and try the next one.', 'code');
    u.twofa = { secret: p.secret, last: step, codes: codes.map((c) => sha(normCode(c))), at: Date.now() };
    delete u.twofaPending;
    notify(u, { kind: 'news', title: 'Two-factor is on', body: 'Sign-in now asks for a code from your authenticator app.' });
    return { ok: true, status: 200, codes };
  });
}

// Turning it off needs the password and a code (from the app, or a recovery code), so a stolen session cannot remove it.
export async function twofaDisable(id, input) {
  const no = noTwofa(id);
  if (no) return no;
  const row = (await q("SELECT data->'pw' AS pw FROM users WHERE id = $1", [id])).rows[0];
  const saved = row?.pw || null;
  const hash = await hashPw(String(input?.password ?? '').slice(0, 200), saved?.salt || DUMMY_SALT);
  if (!saved || !eq(hash, saved.hash)) return fail(422, 'Password is wrong.', 'password');
  return withUser(id, (u) => {
    if (!u?.twofa) return fail(409, 'Two-factor is not on.');
    if (!useSecondFactor(u, input?.code)) return fail(422, WRONG_CODE, 'code');
    delete u.twofa;
    notify(u, { kind: 'news', title: 'Two-factor is off', body: 'Sign-in no longer asks for a code.' });
    return { ok: true, status: 200 };
  });
}

// ---- Closing an account ----
// Self-serve. Needs the password (email accounts), a two-factor code if that is on, and the word DELETE. Refused while a
// withdrawal or payment is unfinished or a balance of at least the withdrawal minimum is left (withdraw it first); a
// smaller balance and any running miners are given up, and the person has to say so (forfeit: true).
// What happens: sign-in data, name, KYC details, alert settings and notifications are erased and the invite codes are
// freed. The row is renamed to a random closed:... id, and the orders, withdrawals and ledger rows follow it, so the books
// stay without the email. Miners, history and the invite fields stay on the closed record because the inviter's rewards
// are worked out from their friends' purchases, so closing never changes what someone else has earned.
const KEEP_ON_CLOSE = ['createdAt', 'cv', 'withdrawn', 'spent', 'adjust', 'contracts', 'history', 'refBy', 'refAt', 'refUsed', 'refRebate', 'refBonusAt', 'refBonusUsd', 'refFirstUsd', 'refRewardAt', 'refCode', 'refCodes'];

async function closeFacts(c, u) {
  const n = (await c.query("SELECT (SELECT count(*) FROM withdrawals WHERE user_id = $1 AND status IN ('pending', 'approved'))::int AS w, (SELECT count(*) FROM orders WHERE user_id = $1 AND status IN ('pending', 'review'))::int AS o", [u.id])).rows[0];
  const now = Date.now();
  return {
    available: await availableIn(c, u),
    withdrawals: n.w,
    orders: n.o,
    miners: u.contracts.filter((m) => !(m.startedAt && m.startedAt + m.days * 86400000 <= now)).length,
  };
}

const closeBlock = (f) =>
  f.withdrawals
    ? 'You have a withdrawal that is not finished yet. Wait until it is sent or rejected, then try again.'
    : f.orders
      ? 'You have a payment that is still being processed. Wait until it is confirmed or expires, then try again.'
      : f.available >= MIN_WITHDRAW
        ? `Withdraw your balance first (${f.available.toFixed(8)} BTC). It cannot be paid out after the account is closed.`
        : null;

// What closing would do, for the confirmation screen.
export async function closePreview(id) {
  const no = noTwofa(id);
  if (no) return no;
  const r = await q('SELECT data FROM users WHERE id = $1', [id]);
  if (!r.rows[0]) return fail(404, 'Account not found.');
  const u = hydrate(id, r.rows[0].data);
  const f = await closeFacts(pool(), u);
  return { ok: true, status: 200, miners: f.miners, blocked: closeBlock(f), password: !!u.pw, twofa: !!u.twofa };
}

export async function closeAccount(id, input) {
  const no = noTwofa(id);
  if (no) return no;
  if (String(input?.confirm ?? '').trim().toUpperCase() !== 'DELETE') return fail(422, 'Type DELETE to confirm.');
  const row = (await q("SELECT data->'pw' AS pw FROM users WHERE id = $1", [id])).rows[0];
  if (!row) return fail(404, 'Account not found.');
  const saved = row.pw || null;
  if (saved) {
    const hash = await hashPw(String(input?.password ?? '').slice(0, 200), saved.salt);
    if (!eq(hash, saved.hash)) return fail(422, 'Password is wrong.', 'password');
  }
  const gone = `closed:${randomBytes(9).toString('base64url')}`;
  return tx(async (c) => {
    const r = await c.query('SELECT data FROM users WHERE id = $1 FOR UPDATE', [id]);
    if (!r.rows[0]) return fail(404, 'Account not found.');
    const u = hydrate(id, r.rows[0].data);
    if (saved && u.pw?.hash !== saved.hash) return fail(409, 'Your password changed while you were doing this. Try again.');
    const f = await closeFacts(c, u);
    const block = closeBlock(f);
    if (block) return fail(409, block);
    if (f.miners && input?.forfeit !== true) {
      return { ...fail(409, `You have ${f.miners} running miner${f.miners === 1 ? '' : 's'}. Closing the account ends ${f.miners === 1 ? 'it' : 'them'} with no refund. Tick the box to continue.`), forfeit: true };
    }
    if (u.twofa) {
      if (!String(input?.code ?? '').trim()) return { ...fail(401, NEED_CODE, 'code'), need2fa: true };
      if (!useSecondFactor(u, input.code)) return fail(422, WRONG_CODE, 'code');
    }
    const kept = { id: gone, closedAt: Date.now() };
    for (const k of KEEP_ON_CLOSE) if (u[k] !== undefined) kept[k] = u[k];
    await c.query('DELETE FROM codes WHERE user_id = $1', [id]);
    await c.query('UPDATE users SET id = $2, data = $3::jsonb, updated_at = now() WHERE id = $1', [id, gone, JSON.stringify(kept)]);
    await c.query("UPDATE users SET ref_by = $2, data = jsonb_set(data, '{refBy}', to_jsonb($2::text)) WHERE ref_by = $1", [id, gone]);
    await c.query('UPDATE ledger SET user_id = $2 WHERE user_id = $1', [id, gone]);
    await c.query('DELETE FROM idem WHERE position($1 in key) > 0', [`:${id}:`]);
    await c.query('DELETE FROM throttle WHERE position($1 in key) > 0', [`:${id}`]);
    return { ok: true, status: 200 };
  });
}

// Eight wrong attempts for one key lock it for 15 minutes. The counters live in the database, so every server shares them.
export const clientIp = (req) => (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
export const throttled = (k) => dbThrottled(`auth:${k}`, 8);
export const noteFail = (k) => dbNoteFail(`auth:${k}`);
export const clearFails = (k) => dbClearFails(`auth:${k}`);

// What the app needs to know about the signed-in user.
export async function whoami(id) {
  const r = id === 'demo' ? null : (await q("SELECT data->>'email' AS email, data->>'tgName' AS name, data->>'emailVerified' AS ev, (data->'twofa') IS NOT NULL AS tf FROM users WHERE id = $1", [id])).rows[0];
  return { id, email: r?.email || null, name: r?.name || null, telegram: id.startsWith('tg:'), demo: id === 'demo', telegramLogin: telegramEnabled(), verified: !!r?.ev, mail: mailEnabled(), twofa: !!r?.tf };
}
