// Admin access and platform actions. Storage lives in lib/server/db.js (shared by every server).
// Admin stays off until ADMIN_TOKEN (12 or more characters) is set in the environment.
// Signing in with that token sets a signed, httpOnly cookie that lasts 12 hours.
// The admin account and the audit log are meta entries "admin" and "adminlog"; sign-in throttling is shared in the database.
import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { BTC_USD, plans as defaultPlans, halls as defaultHalls } from '@/lib/data';
import {
  q, warm, metaGet, metaUpdate, metaDelete, catalog, tx, allUsers, allUserIds, userExists, withUser, withUsers, createUser, saveUser, notify, peekSerial, ledger,
  throttled as dbThrottled, noteFail as dbNoteFail, clearFails as dbClearFails,
} from '@/lib/server/db';
import { grantPlan, adminOrders, reviewOrder } from '@/lib/server/miners';
import { adminWithdrawals, reviewWithdrawal } from '@/lib/server/withdrawals';
import { availableIn } from '@/lib/server/wallet';
import { adminView, saveSettings, resetSettings, resolveCode, assignCode, applyLink } from '@/lib/server/referrals';

export const COOKIE = 'opus_admin';
export const MAX_AGE = 12 * 3600; // seconds

const scrypt = promisify(scryptCb);
const secret = () => process.env.ADMIN_TOKEN || '';
export const adminEnabled = () => secret().length >= 12;

const sha = (s) => createHash('sha256').update(String(s)).digest();
const same = (a, b) => timingSafeEqual(sha(a), sha(b));
// A new admin password changes pwAt, which ends every older session.
const sign = (exp) => {
  const pwAt = metaGet('admin')?.pwAt;
  return createHmac('sha256', secret()).update(`opus-admin:${exp}${pwAt ? `:${pwAt}` : ''}`).digest('hex');
};

export const checkToken = (t) => adminEnabled() && same(t ?? '', secret());

// First login: ADMIN_TOKEN is the one-time setup code. The person picks a username and password,
// which are stored (password salted and hashed) and used from then on. ADMIN_TOKEN keeps signing the session cookie.
// Locked out? Set ADMIN_RESET=1, redeploy, create the account again, then remove ADMIN_RESET.
export async function needsSetup() {
  if (!adminEnabled()) return false;
  await warm();
  return !metaGet('admin') || process.env.ADMIN_RESET === '1';
}
const hashPw = async (pw, salt) => (await scrypt(String(pw), salt, 32)).toString('hex');

export async function setupAdmin(token, user, pass) {
  if (!(await needsSetup())) return { ok: false, status: 409, error: 'Admin is already set up.' };
  if (!checkToken(token)) return { ok: false, status: 401, error: 'Wrong setup token.', bad: true };
  const name = String(user ?? '').trim();
  const pw = String(pass ?? '');
  if (name.length < 3 || name.length > 32) return { ok: false, status: 422, error: 'Username must be 3 to 32 characters.' };
  if (pw.length < 10 || pw.length > 200) return { ok: false, status: 422, error: 'Password must be at least 10 characters.' };
  const salt = randomBytes(16).toString('hex');
  const account = { user: name, salt, hash: await hashPw(pw, salt) };
  // Under a lock, so two people finishing setup at once cannot both win.
  return metaUpdate('admin', (cur) => {
    if (cur && process.env.ADMIN_RESET !== '1') return { result: { ok: false, status: 409, error: 'Admin is already set up.' } };
    return { value: account, result: { ok: true, status: 200 } };
  });
}

export async function checkLogin(user, pass) {
  await warm();
  const a = metaGet('admin');
  if (!a || (await needsSetup())) return false;
  const okUser = same(String(user ?? '').trim().toLowerCase(), a.user.toLowerCase());
  const okPass = same(await hashPw(String(pass ?? '').slice(0, 200), a.salt), a.hash);
  return okUser && okPass;
}

export function newSession() {
  const exp = Date.now() + MAX_AGE * 1000;
  return `${exp}.${sign(exp)}`;
}

export async function isAdmin(req) {
  if (!adminEnabled()) return false;
  await warm();
  const [exp, sig] = String(req.cookies.get(COOKIE)?.value || '').split('.');
  return !!sig && Number(exp) > Date.now() && same(sig, sign(exp));
}

// Five wrong tokens from one address locks sign-in for that address for 15 minutes. Shared by all servers.
export const clientIp = (req) => (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
export const throttled = (ip) => dbThrottled(`admin:${ip}`, 5);
export const noteFail = (ip) => dbNoteFail(`admin:${ip}`);
export const clearFails = (ip) => dbClearFails(`admin:${ip}`);

// Everything the admin screen shows, in one read.
export async function overview() {
  await warm(true);
  const list = await allUsers();
  const stats = { users: list.length, miners: 0, online: 0, th: 0, dailyUsd: 0, withdrawnBtc: 0, kycPending: 0, ordersReview: 0 };
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
      adjust: u.adjust || 0,
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
  const [orders, referrals, serial, withdrawals] = await Promise.all([adminOrders(), adminView(), peekSerial(), adminWithdrawals()]);
  stats.ordersReview = orders.filter((o) => o.status === 'review').length;
  stats.withdrawalsOpen = withdrawals.filter((w) => w.status === 'pending' || w.status === 'approved').length;
  stats.th = Math.round(stats.th * 10) / 10;
  stats.dailyUsd = Math.round(stats.dailyUsd * 100) / 100;
  return { stats, users, orders, withdrawals, log: (metaGet('adminlog') || []).slice(0, 30), catalog: catalog(), referrals, mode: 'postgres', btcUsd: BTC_USD, serial };
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

// Catalogue edits run under a lock on the "catalog" entry, so two admins editing at once cannot overwrite each other.
// fn(cat) changes a copy and returns { ok: false, ... } to cancel, or anything else to save it.
function editCatalog(fn) {
  return metaUpdate('catalog', async (cur) => {
    const cat = structuredClone(cur || { plans: defaultPlans, halls: defaultHalls });
    const r = await fn(cat);
    if (r?.ok === false) return { result: r };
    syncDaily(cat);
    return { value: cat, result: r };
  });
}

// A hall's rate changed: bring the daily payout of the miners in it in line. Returns how many changed.
async function applyRate(hallId, net) {
  let n = 0;
  const ids = await allUserIds();
  for (let i = 0; i < ids.length; i += 50) {
    n += await withUsers(ids.slice(i, i + 50), (map) => {
      let k = 0;
      for (const u of map.values()) {
        u.contracts.forEach((c) => {
          if (c.hall === hallId) {
            c.dailyUsd = Math.round(c.th * net * 100) / 100;
            k += 1;
          }
        });
      }
      return k;
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
  return editCatalog((cat) => {
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
    return done;
  });
}

// The most one adjustment can move, in BTC. A bigger change is made in several steps, each one logged.
const MAX_ADJUST_BTC = 10;

// Adds to or takes from a user's balance. The change is a signed entry in u.adjust, which the balance counts (see
// earnedOf in wallet.js), so it can always be reversed with the opposite entry. It never edits withdrawn or spent.
// Taking money is refused when it would leave the available balance below zero. The user sees it in their activity
// and notifications, and it is written to the ledger and the audit log.
function adjustBalance(userId, input) {
  const op = String(input?.op ?? '');
  if (op !== 'add' && op !== 'subtract') return fail(400, 'Choose add or subtract.');
  const amount = num(input?.amountBtc);
  if (!Number.isFinite(amount) || amount <= 0) return fail(422, 'Enter an amount in BTC.');
  if (amount > MAX_ADJUST_BTC) return fail(422, `Up to ${MAX_ADJUST_BTC} BTC at a time.`);
  const btc = Math.round(amount * 1e8) / 1e8;
  if (btc <= 0) return fail(422, 'Amount is too small. The smallest step is 0.00000001 BTC.');
  const note = text(input?.note, 80);
  if (!note) return fail(422, 'Add a note for the record.');
  const signed = op === 'add' ? btc : -btc;
  return withUser(userId, async (u, c) => {
    if (!u) return fail(404, 'User not found.');
    if (signed < 0 && btc > (await availableIn(c, u))) return fail(409, 'More than the available balance of this user.');
    u.adjust = Math.round(((u.adjust || 0) + signed) * 1e8) / 1e8;
    u.history.unshift({
      kind: 'adjustment',
      label: signed > 0 ? 'Balance added by support' : 'Balance deducted by support',
      date: 'Just now',
      at: Date.now(),
      amount: `${signed > 0 ? '+' : '-'}${btc.toFixed(8)}`,
      coin: 'BTC',
      net: 'BTC',
    });
    notify(u, { kind: 'news', title: 'Balance updated', body: `${signed > 0 ? '+' : '-'}${btc.toFixed(8)} BTC was ${signed > 0 ? 'added to' : 'taken from'} your balance by support.` });
    await ledger(c, userId, 'adjust', { btc: signed, ref: note });
    return { ...done, adjust: u.adjust };
  });
}

// Halls the custom-power sizes depend on (see hallFor in lib/data.js). They can be edited but never removed.
const CORE_HALLS = new Set(['tx-1', 'is-2', 'no-1']);

function uniqueHallId(name, halls) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 10) || 'hall';
  let id = base;
  for (let i = 2; Object.hasOwn(halls, id); i += 1) id = `${base}${i}`;
  return id;
}

async function saveHall(input) {
  const isNew = !input?.id;
  const id = String(input?.id ?? '');
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
  const r = await editCatalog((cat) => {
    if (!isNew && !Object.hasOwn(cat.halls, id)) return fail(404, 'Hall not found.');
    if (isNew && Object.keys(cat.halls).length >= 12) return fail(409, 'Up to 12 halls.');
    if (isNew) {
      cat.halls[uniqueHallId(hall.name, cat.halls)] = { ...hall, net };
      return done;
    }
    const changed = net !== cat.halls[id].net;
    Object.assign(cat.halls[id], hall, { net });
    return { ...done, rateChanged: changed };
  });
  if (!r.ok || isNew) return r.ok ? done : r;
  return { ...done, updated: r.rateChanged ? await applyRate(id, net) : 0 };
}

// A hall can go only when nothing points at it: no plan, no miner, no open order.
function deleteHall(input) {
  const id = String(input?.id ?? '');
  return editCatalog(async (cat) => {
    if (!Object.hasOwn(cat.halls, id)) return fail(404, 'Hall not found.');
    if (CORE_HALLS.has(id)) return fail(409, 'This hall sets the price of custom power, so it can be edited but not removed.');
    if (cat.plans.some((p) => p.hall === id)) return fail(409, 'A plan still uses this hall. Move or delete that plan first.');
    if ((await q('SELECT 1 FROM users WHERE data->\'contracts\' @> $1::jsonb LIMIT 1', [JSON.stringify([{ hall: id }])])).rowCount) return fail(409, 'Miners are running in this hall.');
    if ((await q("SELECT 1 FROM orders WHERE status IN ('pending', 'review') AND data->'plan'->>'hall' = $1 LIMIT 1", [id])).rowCount) return fail(409, 'An open order uses this hall.');
    delete cat.halls[id];
    return done;
  });
}

// Move a plan one place up or down in the list people see.
function movePlan(input) {
  return editCatalog((cat) => {
    const i = cat.plans.findIndex((p) => p.id === String(input?.id ?? ''));
    if (i < 0) return fail(404, 'Plan not found.');
    const j = input?.dir === 'up' ? i - 1 : input?.dir === 'down' ? i + 1 : -1;
    if (j < 0 || j >= cat.plans.length) return fail(409, 'Cannot move further.');
    [cat.plans[i], cat.plans[j]] = [cat.plans[j], cat.plans[i]];
    return done;
  });
}

const LOGGED = new Set(['notify', 'ref-settings', 'ref-reset', 'ref-test', 'plan-save', 'hall-save', 'plan-delete', 'plan-move', 'hall-delete', 'catalog-reset', 'kyc', 'miners-clear', 'miner', 'order', 'withdrawal', 'balance', 'admin-password']);

// One entry point for every change the admin screen can make. Every change that worked is written to the audit log.
export async function act(input) {
  const r = await perform(input);
  const action = String(input?.action ?? '');
  if (r.ok && LOGGED.has(action)) {
    const detail = ['userId', 'serial', 'op', 'decision', 'orderId', 'withdrawalId', 'planId', 'code', 'id', 'dir', 'amountBtc', 'note'].map((k) => input?.[k]).filter(Boolean).join(' · ');
    const entry = { at: Date.now(), action, detail: detail.slice(0, 120) };
    await metaUpdate('adminlog', (cur) => ({ value: [entry, ...(cur || [])].slice(0, 100) }));
  }
  return r;
}

async function perform(input) {
  const action = String(input?.action ?? '');
  const userId = String(input?.userId ?? '');
  await warm();

  if (action === 'notify') {
    const title = String(input.title ?? '').trim().slice(0, 80);
    const body = String(input.body ?? '').trim().slice(0, 240);
    if (!title) return fail(422, 'Add a title.');
    const ids = userId === 'all' ? await allUserIds() : (await userExists(userId)) ? [userId] : [];
    if (!ids.length) return fail(404, 'User not found.');
    for (let i = 0; i < ids.length; i += 100) {
      await withUsers(ids.slice(i, i + 100), (map) => {
        for (const u of map.values()) notify(u, { kind: 'news', title, body });
      });
    }
    return { ...done, sent: ids.length };
  }

  if (action === 'admin-password') {
    const a = metaGet('admin');
    const next = String(input?.next ?? '');
    if (!a || !(await checkLogin(a.user, input?.current))) return fail(401, 'Current password is wrong.');
    if (next.length < 10 || next.length > 200) return fail(422, 'New password must be at least 10 characters.');
    const salt = randomBytes(16).toString('hex');
    const account = { ...a, salt, hash: await hashPw(next, salt), pwAt: Date.now() };
    await metaUpdate('admin', () => ({ value: account }));
    return { ...done, session: newSession() };
  }

  if (action === 'ref-settings') return saveSettings(input?.settings);
  if (action === 'ref-reset') return resetSettings();
  if (action === 'ref-test') {
    // Creates a test friend, links them to the inviter's code and buys a plan for them, so the whole reward flow can be tried.
    if (!(await resolveCode(input?.code))) return fail(404, 'Invite code not found.');
    const made = await tx(async (c) => {
      for (let n = 1; n < 1000; n += 1) {
        const f = await createUser(c, `friend${n}@test`, {});
        if (!f) continue;
        await assignCode(c, f);
        const l = await applyLink(c, f, input.code);
        if (!l.ok) {
          const err = new Error(l.error);
          err.link = l;
          throw err;
        }
        await saveUser(c, f);
        return f.id;
      }
      return null;
    }).catch((e) => (e.link ? e.link : Promise.reject(e)));
    if (!made) return fail(409, 'Too many test accounts.');
    if (typeof made === 'object') return made;
    const r = await grantPlan(made, String(input?.planId ?? ''));
    if (!r.ok) return r;
    return { ...done, friend: made };
  }

  if (action === 'plan-save') return savePlan(input);
  if (action === 'hall-save') return saveHall(input);
  if (action === 'hall-delete') return deleteHall(input);
  if (action === 'plan-move') return movePlan(input);
  if (action === 'plan-delete') {
    const id = String(input?.id ?? '');
    return editCatalog((cat) => {
      if (!cat.plans.some((p) => p.id === id)) return fail(404, 'Plan not found.');
      if (cat.plans.length <= 1) return fail(409, 'Keep at least one plan.');
      cat.plans = cat.plans.filter((p) => p.id !== id);
      return done;
    });
  }
  if (action === 'catalog-reset') {
    // Back to the defaults in lib/data.js. Existing miners follow the default hall rates again.
    await warm(true);
    const before = catalog().halls;
    const core = [...CORE_HALLS];
    const custom = await q("SELECT 1 FROM users WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(data->'contracts') k WHERE k->>'hall' <> ALL($1::text[])) LIMIT 1", [core]);
    if (custom.rowCount) return fail(409, 'Miners are running in a hall you added. Remove them or keep the halls.');
    await metaDelete('catalog');
    const after = defaultHalls;
    let updated = 0;
    for (const id of Object.keys(after)) if (before[id]?.net !== after[id].net) updated += await applyRate(id, after[id].net);
    return { ...done, updated };
  }

  if (!(await userExists(userId))) return fail(404, 'User not found.');

  if (action === 'order') {
    const r = await reviewOrder(userId, input?.orderId, String(input?.decision ?? ''));
    return r.ok ? { ...done, serial: r.serial } : r;
  }

  if (action === 'withdrawal') return reviewWithdrawal(userId, input?.withdrawalId, String(input?.decision ?? ''), input?.txid);

  if (action === 'kyc') {
    return withUser(userId, (u) => {
      if (!u) return fail(404, 'User not found.');
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
    });
  }

  if (action === 'balance') return adjustBalance(userId, input);

  if (action === 'miners-clear') {
    return withUser(userId, (u) => {
      if (!u) return fail(404, 'User not found.');
      const n = u.contracts.length;
      if (!n) return fail(409, 'No miners to remove.');
      u.contracts.length = 0;
      notify(u, { kind: 'news', title: 'Miners removed', body: `${n} miner${n === 1 ? ' was' : 's were'} removed by support.` });
      return { ...done, removed: n };
    });
  }

  if (action === 'miner') {
    return withUser(userId, (u) => {
      if (!u) return fail(404, 'User not found.');
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
    });
  }

  return fail(400, 'Unknown action.');
}
