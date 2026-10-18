// Admin access and platform actions. Storage lives in lib/server/db.js.
// Admin stays off until ADMIN_TOKEN (12 or more characters) is set in the environment.
// Signing in with that token sets a signed, httpOnly cookie that lasts 12 hours.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { BTC_USD } from '@/lib/data';
import { store, userOf, notify, catalog, setCatalog } from '@/lib/server/db';
import { buyPlan } from '@/lib/server/miners';
import { adminView, saveSettings, resetSettings, findByCode, link } from '@/lib/server/referrals';

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
  return { stats, users, catalog: catalog(), referrals: adminView(), mode: store.mode || 'memory', btcUsd: BTC_USD, serial: store.serial };
}

const fail = (status, error) => ({ ok: false, status, error });
const done = { ok: true, status: 200 };

const num = (v) => Number(String(v ?? '').trim().replace(',', '.'));
const text = (v, max) => String(v ?? '').trim().slice(0, max);

// A plan's daily payout is always its size times its hall's net rate, so it is derived, never typed in.
function syncDaily(cat) {
  cat.plans.forEach((p) => {
    p.daily = `$${(p.th * cat.halls[p.hall].net).toFixed(2)}`;
  });
}

// A hall's rate changed: bring the daily payout of the miners in it in line. Returns how many changed.
function applyRate(hallId, net) {
  let n = 0;
  for (const id of store.users.keys()) {
    userOf(id).contracts.forEach((c) => {
      if (c.hall === hallId) {
        c.dailyUsd = Math.round(c.th * net * 100) / 100;
        n += 1;
      }
    });
  }
  return n;
}

function uniqueId(name, plans) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'plan';
  let id = base;
  for (let i = 2; plans.some((p) => p.id === id); i += 1) id = `${base}${i}`;
  return id;
}

function savePlan(input) {
  const cat = structuredClone(catalog());
  const p = input?.plan ?? {};
  const name = text(p.name, 24);
  const th = num(p.th);
  const price = num(p.price);
  const days = num(p.days);
  const hall = String(p.hall ?? '');
  if (!name) return fail(422, 'Add a name.');
  if (!Number.isFinite(th) || th <= 0 || th > 100000) return fail(422, 'Hash power must be between 0 and 100,000 TH/s.');
  if (!Number.isFinite(price) || price <= 0 || price > 10_000_000) return fail(422, 'Enter a price.');
  if (!Number.isInteger(days) || days < 1 || days > 1825) return fail(422, 'Term must be 1 to 1825 whole days.');
  if (!Object.hasOwn(cat.halls, hall)) return fail(422, 'Choose a hall.');
  let plan = null;
  if (p.id) {
    plan = cat.plans.find((x) => x.id === String(p.id));
    if (!plan) return fail(404, 'Plan not found.');
  }
  const fields = { name, th, price: Math.round(price * 100) / 100, days, hall, blurb: text(p.blurb, 140) };
  if (plan) Object.assign(plan, fields);
  else {
    plan = { id: uniqueId(name, cat.plans), ...fields };
    cat.plans.push(plan);
  }
  if (p.featured) {
    cat.plans.forEach((x) => {
      if (x !== plan) delete x.featured;
    });
    plan.featured = true;
  } else {
    delete plan.featured;
  }
  syncDaily(cat);
  setCatalog(cat);
  return done;
}

function saveHall(input) {
  const cat = structuredClone(catalog());
  const id = String(input?.id ?? '');
  if (!Object.hasOwn(cat.halls, id)) return fail(404, 'Hall not found.');
  const d = input?.hall ?? {};
  const hall = {
    name: text(d.name, 40),
    place: text(d.place, 40),
    power: text(d.power, 60),
    efficiency: text(d.efficiency, 20),
    rig: text(d.rig, 40),
  };
  if (Object.values(hall).some((v) => !v)) return fail(422, 'Fill in every field.');
  const net = num(d.net);
  if (!Number.isFinite(net) || net < 0 || net > 0.1) return fail(422, 'Net rate must be between 0 and 0.1 USD per TH/s per day.');
  const changed = net !== cat.halls[id].net;
  Object.assign(cat.halls[id], hall, { net });
  syncDaily(cat);
  setCatalog(cat);
  return { ...done, updated: changed ? applyRate(id, net) : 0 };
}

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

  if (action === 'ref-settings') return saveSettings(input?.settings);
  if (action === 'ref-reset') return resetSettings();
  if (action === 'ref-test') {
    // Creates a test friend, links them to the inviter's code and buys a plan for them, so the whole reward flow can be tried.
    if (!findByCode(input?.code)) return fail(404, 'Invite code not found.');
    let n = 1;
    while (store.users.has(`friend${n}@test`)) n += 1;
    const id = `friend${n}@test`;
    const f = userOf(id);
    f.contracts.length = 0;
    f.history.length = 0;
    f.notifications.length = 0;
    const l = link(id, input.code);
    if (!l.ok) return l;
    const r = buyPlan({ planId: String(input?.planId ?? '') }, { userId: id });
    if (!r.ok) return r;
    return { ...done, friend: id };
  }

  if (action === 'plan-save') return savePlan(input);
  if (action === 'hall-save') return saveHall(input);
  if (action === 'plan-delete') {
    const cat = structuredClone(catalog());
    const id = String(input?.id ?? '');
    if (!cat.plans.some((p) => p.id === id)) return fail(404, 'Plan not found.');
    if (cat.plans.length <= 1) return fail(409, 'Keep at least one plan.');
    cat.plans = cat.plans.filter((p) => p.id !== id);
    setCatalog(cat);
    return done;
  }
  if (action === 'catalog-reset') {
    // Back to the defaults in lib/data.js. Existing miners follow the default hall rates again.
    const before = catalog().halls;
    setCatalog(null);
    const after = catalog().halls;
    let updated = 0;
    for (const id of Object.keys(after)) if (before[id]?.net !== after[id].net) updated += applyRate(id, after[id].net);
    return { ...done, updated };
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

  if (action === 'miners-clear') {
    const n = u.contracts.length;
    if (!n) return fail(409, 'No miners to remove.');
    u.contracts.length = 0;
    notify(u, { kind: 'news', title: 'Miners removed', body: `${n} miner${n === 1 ? ' was' : 's were'} removed by support.` });
    return { ...done, removed: n };
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
