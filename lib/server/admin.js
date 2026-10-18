// Admin access and platform actions. Storage lives in lib/server/db.js.
// Admin stays off until ADMIN_TOKEN (12 or more characters) is set in the environment.
// Signing in with that token sets a signed, httpOnly cookie that lasts 12 hours.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { BTC_USD } from '@/lib/data';
import { store, userOf, notify } from '@/lib/server/db';

export const COOKIE = 'opus_admin';
export const MAX_AGE = 12 * 3600; // seconds

const secret = () => process.env.ADMIN_TOKEN || '';
export const adminEnabled = () => secret().length >= 12;

const sha = (s) => createHash('sha256').update(String(s)).digest();
const same = (a, b) => timingSafeEqual(sha(a), sha(b));
const sign = (exp) => createHmac('sha256', secret()).update(`opus-admin:${exp}`).digest('hex');

export const checkToken = (t) => adminEnabled() && same(t ?? '', secret());

export function newSession() {
  const exp = Date.now() + MAX_AGE * 1000;
  return `${exp}.${sign(exp)}`;
}

export function isAdmin(req) {
  if (!adminEnabled()) return false;
  const [exp, sig] = String(req.cookies.get(COOKIE)?.value || '').split('.');
  return !!sig && Number(exp) > Date.now() && same(sig, sign(exp));
}

// Five wrong tokens from one address locks sign-in for that address until the 15 minute window ends.
const tries = (globalThis.__adminTries ||= new Map());
export const clientIp = (req) => (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
export function throttled(ip) {
  const t = tries.get(ip);
  return !!t && t.n >= 5 && Date.now() < t.until;
}
export function noteFail(ip) {
  const now = Date.now();
  const t = tries.get(ip);
  if (!t || now > t.until) tries.set(ip, { n: 1, until: now + 15 * 60_000 });
  else t.n += 1;
  if (tries.size > 200) tries.clear();
}
export const clearFails = (ip) => tries.delete(ip);

// Everything the admin screen shows, in one read.
export function overview() {
  if (!store.users.size) userOf('demo');
  const list = [...store.users.keys()].map((id) => userOf(id));
  const stats = { users: list.length, miners: 0, online: 0, th: 0, dailyUsd: 0, withdrawnBtc: 0, kycPending: 0 };
  const users = list.map((u) => {
    u.contracts.forEach((c) => {
      stats.miners += 1;
      if (c.online) {
        stats.online += 1;
        stats.th += c.th;
        stats.dailyUsd += c.dailyUsd;
      }
    });
    stats.withdrawnBtc += u.withdrawn || 0;
    if (u.kyc.status === 'pending') stats.kycPending += 1;
    const k = u.kyc;
    return {
      id: u.id,
      withdrawn: u.withdrawn || 0,
      kyc: { status: k.status, name: k.name, dob: k.dob, country: k.country, doc: k.doc, submittedAt: k.submittedAt, photos: k.photos },
      miners: u.contracts.map((c) => ({
        serial: c.serial,
        name: c.name,
        th: c.th,
        hall: c.hall,
        online: !!c.online,
        dailyUsd: c.dailyUsd,
        days: c.days,
        elapsed: c.elapsed,
        ends: c.ends,
      })),
    };
  });
  stats.th = Math.round(stats.th * 10) / 10;
  stats.dailyUsd = Math.round(stats.dailyUsd * 100) / 100;
  return { stats, users, mode: store.mode || 'memory', btcUsd: BTC_USD, serial: store.serial };
}

const fail = (status, error) => ({ ok: false, status, error });
const done = { ok: true, status: 200 };

// One entry point for every change the admin screen can make.
export function act(input) {
  const action = String(input?.action ?? '');
  const userId = String(input?.userId ?? '');

  if (action === 'notify') {
    const title = String(input.title ?? '').trim().slice(0, 80);
    const body = String(input.body ?? '').trim().slice(0, 240);
    if (!title) return fail(422, 'Add a title.');
    const targets = userId === 'all' ? [...store.users.keys()].map((id) => userOf(id)) : store.users.has(userId) ? [userOf(userId)] : [];
    if (!targets.length) return fail(404, 'User not found.');
    targets.forEach((t) => notify(t, { kind: 'news', title, body }));
    return { ...done, sent: targets.length };
  }

  if (!store.users.has(userId)) return fail(404, 'User not found.');
  const u = userOf(userId);

  if (action === 'kyc') {
    if (u.kyc.status !== 'pending') return fail(409, 'Nothing to review.');
    if (input.decision === 'approve') {
      u.kyc = { ...u.kyc, status: 'verified', reviewedAt: Date.now() };
      notify(u, { kind: 'news', title: 'Identity verified', body: 'Your verification was approved.' });
    } else if (input.decision === 'reject') {
      // Back to "none" so the person can submit again.
      u.kyc = { status: 'none', rejectedAt: Date.now() };
      notify(u, { kind: 'news', title: 'Verification not approved', body: 'Check your details and submit again.' });
    } else {
      return fail(400, 'Unknown decision.');
    }
    return done;
  }

  if (action === 'miner') {
    const i = u.contracts.findIndex((c) => c.serial === String(input.serial ?? ''));
    if (i < 0) return fail(404, 'Miner not found.');
    const c = u.contracts[i];
    if (input.op === 'online' || input.op === 'offline') {
      c.online = input.op === 'online';
    } else if (input.op === 'delete') {
      u.contracts.splice(i, 1);
      notify(u, { kind: 'news', title: 'Miner removed', body: `${c.serial} was removed by support.` });
    } else {
      return fail(400, 'Unknown operation.');
    }
    return done;
  }

  return fail(400, 'Unknown action.');
}
