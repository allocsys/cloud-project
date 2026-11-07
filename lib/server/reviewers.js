// View-only access for /adtg. The admin adds and removes reviewer accounts on the Admin screen (Settings, Reviewers).
// They are kept as the meta entry "reviewers": [{ user, salt, hash, at }], the password salted and hashed like the admin one.
// A session is a signed, httpOnly cookie that lasts 12 hours. It stops working at once when the reviewer is removed or the
// account is made again (at changes). Reviewers can only read: the one data route they have is GET /api/adtg.
// This file must not import lib/server/admin.js (admin.js imports it).
import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { metaGet, metaUpdate, warm } from '@/lib/server/db';

export const REVIEW_COOKIE = 'vtx_review';
export const REVIEW_MAX_AGE = 12 * 3600; // seconds
export const REVIEWER_MAX = 10;

const scrypt = promisify(scryptCb);
const secret = () => process.env.ADMIN_TOKEN || '';
// Same switch as the admin: off until ADMIN_TOKEN (12 or more characters) is set, because it also signs the session cookie.
export const reviewEnabled = () => secret().length >= 12;

const sha = (s) => createHash('sha256').update(String(s)).digest();
const same = (a, b) => timingSafeEqual(sha(a), sha(b));
const hashPw = async (pw, salt) => (await scrypt(String(pw), salt, 32)).toString('hex');
const sign = (user, exp, at) => createHmac('sha256', secret()).update(`vtx-review:${user}:${exp}:${at}`).digest('hex');
const fail = (status, error) => ({ ok: false, status, error });
const list = () => metaGet('reviewers') || [];
const nameOf = (v) => String(v ?? '').trim().toLowerCase();

// Names and dates only, for the Admin screen.
export const reviewerList = () => list().map((r) => ({ user: r.user, at: r.at }));

export async function addReviewer(user, pass) {
  const name = nameOf(user);
  const pw = String(pass ?? '');
  if (!/^[a-z0-9_-]{3,32}$/.test(name)) return fail(422, 'Username: 3 to 32 letters, numbers, - or _.');
  if (pw.length < 10 || pw.length > 200) return fail(422, 'Password must be at least 10 characters.');
  const salt = randomBytes(16).toString('hex');
  const rec = { user: name, salt, hash: await hashPw(pw, salt), at: Date.now() };
  // Under a lock, so two admins adding at once cannot overwrite each other.
  return metaUpdate('reviewers', (cur) => {
    const l = cur || [];
    if (l.some((r) => r.user === name)) return { result: fail(409, 'That username is taken.') };
    if (l.length >= REVIEWER_MAX) return { result: fail(409, `Up to ${REVIEWER_MAX} reviewers.`) };
    return { value: [...l, rec], result: { ok: true, status: 200 } };
  });
}

export async function removeReviewer(user) {
  const name = nameOf(user);
  return metaUpdate('reviewers', (cur) => {
    const l = cur || [];
    if (!l.some((r) => r.user === name)) return { result: fail(404, 'Reviewer not found.') };
    return { value: l.filter((r) => r.user !== name), result: { ok: true, status: 200 } };
  });
}

// The reviewer record when the name and password are right, otherwise null. The hash is worked out either way, so timing does not tell a wrong name from a wrong password.
export async function reviewerLogin(user, pass) {
  await warm();
  const name = nameOf(user);
  const r = list().find((x) => x.user === name);
  const h = await hashPw(String(pass ?? '').slice(0, 200), r?.salt || '00'.repeat(16));
  return r && same(h, r.hash) ? r : null;
}

export function reviewSession(r) {
  const exp = Date.now() + REVIEW_MAX_AGE * 1000;
  return `${r.user}.${exp}.${sign(r.user, exp, r.at)}`;
}

// The signed-in reviewer's name, or null.
export async function reviewerOf(req) {
  if (!reviewEnabled()) return null;
  await warm();
  const [user, exp, sig] = String(req.cookies.get(REVIEW_COOKIE)?.value || '').split('.');
  if (!user || !sig || !(Number(exp) > Date.now())) return null;
  const r = list().find((x) => x.user === user);
  return r && same(sig, sign(user, exp, r.at)) ? r.user : null;
}

// What a reviewer may see of the admin overview: people, money and requests. No settings, no private admin notes, no ID photos.
export function reviewView(o) {
  return {
    stats: o.stats,
    btcUsd: o.btcUsd,
    rate: o.rate,
    users: o.users.map(({ kyc, note, ...u }) => ({ ...u, kyc: { status: kyc.status, name: kyc.name, dob: kyc.dob, country: kyc.country, doc: kyc.doc, submittedAt: kyc.submittedAt } })),
    orders: o.orders,
    withdrawals: o.withdrawals,
    refunds: o.refunds,
  };
}
