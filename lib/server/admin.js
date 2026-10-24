// Admin access and platform actions. Storage lives in lib/server/db.js (shared by every server).
// Admin stays off until ADMIN_TOKEN (12 or more characters) is set in the environment.
// Signing in with that token sets a signed, httpOnly cookie that lasts 12 hours.
// The admin account and the audit log are meta entries "admin" and "adminlog"; sign-in throttling is shared in the database.
import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { REFUND_HOURS } from '@/lib/rules';
import { BTC_USD, halls as defaultHalls } from '@/lib/data';
import {
  q, warm, metaGet, metaUpdate, metaDelete, catalog, tx, allUsers, allUserIds, userExists, withUser, withUsers, usersIn, hydrate, createUser, saveUser, notify, peekSerial, ledger,
  throttled as dbThrottled, noteFail as dbNoteFail, clearFails as dbClearFails, hit as dbHit, release as dbRelease,
} from '@/lib/server/db';
import { grantPlan, adminOrders, reviewOrder } from '@/lib/server/miners';
import { adminWithdrawals, reviewWithdrawal } from '@/lib/server/withdrawals';
import { availableIn, availableOf, TOLERANCE } from '@/lib/server/wallet';
import { getMarket } from '@/lib/server/market';
import { getPrices } from '@/lib/server/prices';
import { mockCharts, setMockCharts, feedStatus } from '@/lib/server/telemetry';
import { smartSettings, saveSmartSettings, smartCoinList, smartDayTable, setSmartCoin, setSmartCoinRig, smartHallList, saveSmartHall, resetSmartHalls } from '@/lib/server/smart-admin';
import { smartCost } from '@/lib/server/smart-market';
import { guardOverview, guardBacktest, saveGuardSettings, setGuardManual } from '@/lib/server/guard';
import { firstBonusSettings, saveFirstBonusSettings } from '@/lib/server/first-bonus';
import { boostSettings, saveBoostSettings } from '@/lib/server/boost';
import { adminView, saveSettings, resetSettings, resolveCode, assignCode, applyLink, settings as referralSettings } from '@/lib/server/referrals';

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
// Counts the attempt first, in one statement, and says whether the address is now over the limit. giveBack() returns an attempt that was not a failure.
export const reserve = (ip) => dbHit(`admin:${ip}`, 5);
export const giveBack = (ip) => dbRelease(`admin:${ip}`);

// Everything the admin screen shows, in one read.
export async function overview() {
  await warm(true);
  const list = await allUsers();
  const stats = { users: list.length, miners: 0, online: 0, th: 0, dailyUsd: 0, withdrawnBtc: 0, kycPending: 0, ordersReview: 0 };
  // The balance each user can still withdraw or spend, from the accounts already loaded (no query per user).
  const byId = new Map(list.map((u) => [u.id, u]));
  const friendsOf = new Map();
  for (const f of list) {
    if (!f.refBy) continue;
    const mine = friendsOf.get(f.refBy);
    if (mine) mine.push(f);
    else friendsOf.set(f.refBy, [f]);
  }
  const S = referralSettings();
  const availableBtc = (u) => Math.round(availableOf({ id: u.id, u, friends: friendsOf.get(u.id) || [], inviter: u.refBy ? byId.get(u.refBy) || null : null, S }) * 1e8) / 1e8;
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
      available: availableBtc(u),
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
  const { prices, source: priceSource } = await getPrices();
  stats.th = Math.round(stats.th * 10) / 10;
  stats.dailyUsd = Math.round(stats.dailyUsd * 100) / 100;
  const [mock, feed, smartSet, smartCoins, smartDays, smartHalls, guard, smartPower] = await Promise.all([mockCharts(), feedStatus(), smartSettings(), smartCoinList().catch(() => []), smartDayTable().catch(() => []), smartHallList(), guardOverview().catch(() => null), smartCost().catch(() => null)]);
  const firstBonus = await firstBonusSettings();
  const boost = await boostSettings();
  return { firstBonus, boost, guard, smart: { settings: smartSet, coins: smartCoins, days: smartDays, cost: smartPower, halls: smartHalls }, stats, users, orders, withdrawals, log: (metaGet('adminlog') || []).slice(0, 30), catalog: catalog(), referrals, mode: 'postgres', btcUsd: BTC_USD, rate: { btc: prices.btc, source: priceSource }, serial, charts: { mock, feed } };
}

const fail = (status, error) => ({ ok: false, status, error });
const done = { ok: true, status: 200 };

const num = (v) => Number(String(v ?? '').trim().replace(',', '.'));
const text = (v, max) => String(v ?? '').trim().slice(0, max);

// Catalogue edits run under a lock on the "catalog" entry, so two admins editing at once cannot overwrite each other.
// fn(cat) changes a copy and returns { ok: false, ... } to cancel, or anything else to save it.
function editCatalog(fn) {
  return metaUpdate('catalog', async (cur) => {
    const cat = structuredClone(cur || { halls: defaultHalls });
    delete cat.plans; // the fixed plans are gone; an older saved catalogue may still carry them
    const r = await fn(cat);
    if (r?.ok === false) return { result: r };
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

// The most one adjustment can move, in BTC. A bigger change is made in several steps, each one logged.
const MAX_ADJUST_BTC = 10;

// Adds to or takes from a user's balance. The change is a signed entry in u.adjust, which the balance counts (see
// earnedOf in wallet.js), so it can always be reversed with the opposite entry. It never edits withdrawn or spent.
// Taking money is refused when it would leave the available balance below zero by more than TOLERANCE, the same
// slack buying a plan and withdrawing allow for rounding. The user sees it in their activity
// and notifications, and it is written to the ledger and the audit log.
// The amount is given in BTC (amountBtc) or in USD (amountUsd, never both). USD is turned into BTC at the live rate,
// the same one plans are priced with; the balance is kept in BTC, and the ledger row records the USD and the rate.
async function adjustBalance(userId, input) {
  const op = String(input?.op ?? '');
  if (op !== 'add' && op !== 'subtract') return fail(400, 'Choose add or subtract.');
  const inUsd = String(input?.amountUsd ?? '').trim() !== '';
  if (inUsd && String(input?.amountBtc ?? '').trim() !== '') return fail(400, 'Give the amount in BTC or in USD, not both.');
  const typed = num(inUsd ? input.amountUsd : input?.amountBtc);
  if (!Number.isFinite(typed) || typed <= 0) return fail(422, `Enter an amount in ${inUsd ? 'USD' : 'BTC'}.`);
  let amount = typed;
  let usd = 0;
  let rate = 0;
  let rateSource = '';
  if (inUsd) {
    usd = Math.round(typed * 100) / 100;
    if (usd <= 0) return fail(422, 'Amount is too small. The smallest step is $0.01.');
    const p = await getPrices();
    rate = p.prices.btc;
    rateSource = p.source;
    if (!(rate > 0)) return fail(503, 'No BTC price is available right now. Try again, or enter the amount in BTC.');
    amount = usd / rate;
  }
  if (amount > MAX_ADJUST_BTC) return fail(422, `Up to ${MAX_ADJUST_BTC} BTC at a time.`);
  const btc = Math.round(amount * 1e8) / 1e8;
  if (btc <= 0) return fail(422, 'Amount is too small. The smallest step is 0.00000001 BTC.');
  const note = text(input?.note, 80);
  if (!note) return fail(422, 'Add a note for the record.');
  const signed = op === 'add' ? btc : -btc;
  await getMarket(); // warms the market cache now, so nothing slow happens while the account is locked
  return withUser(userId, async (u, c) => {
    if (!u) return fail(404, 'User not found.');
    if (signed < 0 && btc > (await availableIn(c, u)) + TOLERANCE) return fail(409, 'More than the available balance of this user.');
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
    await ledger(c, userId, 'adjust', {
      btc: signed,
      ...(usd ? { usd: signed > 0 ? usd : -usd } : {}),
      ref: usd ? `${note} · $${usd.toFixed(2)} at $${rate}/BTC` : note,
    });
    return { ...done, adjust: u.adjust, btc, ...(usd ? { usd, rate, rateSource } : {}) };
  });
}

// A full refund, the one the Terms promise: within 24 hours of the miner starting and before its first payout day has
// finished (payout days run 00:00 to 24:00 UTC, see earnings.js). Only miners that were paid for (balance or crypto)
// qualify, never admin grants, welcome gifts or the demo account. The miner is removed, so whatever it had accrued goes
// with it, and its price is credited back as a signed balance entry in BTC at the live rate; the ledger row keeps the USD
// and the rate. If that was the buyer's last paid miner, their welcome gift goes too, so a refund cannot keep the gift.
// The account row is locked, so two refunds of the same miner cannot both pay out. `now` is only for tests.
const REFUND_MS = REFUND_HOURS * 3600 * 1000;
const DAY_MS = 86400000;

export async function refundMiner(userId, serial, now = Date.now()) {
  const rate = (await getPrices()).prices.btc;
  if (!(rate > 0)) return fail(503, 'No BTC price is available right now. Try again in a moment.');
  return withUser(userId, async (u, c) => {
    if (!u) return fail(404, 'User not found.');
    const i = u.contracts.findIndex((x) => x.serial === serial);
    if (i < 0) return fail(404, 'Miner not found.');
    const m = u.contracts[i];
    if (m.bonus) return fail(409, 'A free gift miner has nothing to refund.');
    if (!Number.isFinite(m.startedAt) || !(m.price > 0)) return fail(409, 'This miner has no purchase record, so it cannot be refunded here.');
    if (now - m.startedAt > REFUND_MS) return fail(409, 'More than 24 hours have passed since this miner started.');
    if (Math.floor(now / DAY_MS) !== Math.floor(m.startedAt / DAY_MS)) return fail(409, 'This miner has already passed its first payout day, so it is past the refund window.');
    const paid = u.history.some((h) => h.kind === 'purchase' && (h.net === 'Balance' || h.net === 'Crypto') && Math.abs((h.at || 0) - m.startedAt) <= 10000);
    if (!paid) return fail(409, 'This miner was not paid for (it was granted), so there is nothing to refund.');

    const usd = Math.round(m.price * 100) / 100;
    const btc = Math.round((usd / rate) * 1e8) / 1e8;
    u.contracts.splice(i, 1);
    let gifts = 0;
    if (!u.contracts.some((x) => !x.bonus)) {
      gifts = u.contracts.filter((x) => x.bonus).length;
      if (gifts) u.contracts = u.contracts.filter((x) => !x.bonus);
    }
    u.adjust = Math.round(((u.adjust || 0) + btc) * 1e8) / 1e8;
    u.history.unshift({ kind: 'adjustment', label: `Refund · ${m.name}`, date: 'Just now', at: Date.now(), amount: `+${btc.toFixed(8)}`, coin: 'BTC', net: 'BTC' });
    notify(u, { kind: 'purchase', title: 'Refund', body: `${m.serial} was refunded: ${btc.toFixed(8)} BTC ($${usd.toFixed(2)}) is back in your balance.${gifts ? ' The welcome gift miner was removed with it.' : ''}` });
    await ledger(c, userId, 'adjust', { btc, usd, ref: `Refund ${m.serial} · $${usd.toFixed(2)} at $${rate}/BTC` });
    return { ...done, serial: m.serial, btc, usd, rate, gifts };
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

// A hall can go only when nothing points at it: no miner, no open order.
function deleteHall(input) {
  const id = String(input?.id ?? '');
  return editCatalog(async (cat) => {
    if (!Object.hasOwn(cat.halls, id)) return fail(404, 'Hall not found.');
    if (CORE_HALLS.has(id)) return fail(409, 'This hall sets the price of custom power, so it can be edited but not removed.');
    if ((await q('SELECT 1 FROM users WHERE data->\'contracts\' @> $1::jsonb LIMIT 1', [JSON.stringify([{ hall: id }])])).rowCount) return fail(409, 'Miners are running in this hall.');
    if ((await q("SELECT 1 FROM orders WHERE status IN ('pending', 'review') AND data->'plan'->>'hall' = $1 LIMIT 1", [id])).rowCount) return fail(409, 'An open order uses this hall.');
    delete cat.halls[id];
    return done;
  });
}

// Wipes the demo account back to a clean slate, in one transaction: its miners, activity, notifications, balance changes,
// withdrawals, payment orders, ledger rows, saved idempotency results and hall samples go, and so do the test friends
// the "Test the invite flow" tool made under it (friendN@test), so no invite income is left behind. The account keeps its
// id and invite code. Real accounts are never touched.
async function resetDemo() {
  return tx(async (c) => {
    const friends = (await c.query("SELECT id, data FROM users WHERE ref_by = 'demo' AND id ~ '^friend[0-9]+@test$'")).rows;
    const ids = ['demo', ...friends.map((f) => f.id)];
    const serials = new Set(friends.flatMap((f) => (f.data?.contracts || []).map((x) => x.serial)));
    const wiped = await usersIn(c, ['demo'], (map) => {
      const u = map.get('demo');
      const n = u.contracts.length;
      u.contracts.forEach((x) => serials.add(x.serial));
      const keep = { refCode: u.refCode, createdAt: u.createdAt };
      for (const k of Object.keys(u)) delete u[k];
      Object.assign(u, hydrate('demo', { withdrawn: 0, history: [], contracts: [], notifications: [] }), Object.fromEntries(Object.entries(keep).filter(([, v]) => v !== undefined)));
      return n;
    });
    await c.query('DELETE FROM users WHERE id = ANY($1::text[])', [friends.map((f) => f.id)]);
    await c.query('DELETE FROM orders WHERE user_id = $1', ['demo']);
    await c.query('DELETE FROM withdrawals WHERE user_id = $1', ['demo']);
    await c.query('DELETE FROM ledger WHERE user_id = ANY($1::text[])', [ids]);
    await c.query("DELETE FROM idem WHERE key LIKE '%:demo:%'");
    if (serials.size) await c.query('DELETE FROM hash_samples WHERE serial = ANY($1::text[])', [[...serials]]);
    return { ...done, miners: wiped, friends: friends.length };
  });
}

const LOGGED = new Set(['notify', 'ref-settings', 'ref-reset', 'ref-test', 'hall-save', 'hall-delete', 'catalog-reset', 'kyc', 'miners-clear', 'miner', 'order', 'withdrawal', 'balance', 'admin-password', 'charts-mock', 'demo-reset', 'smart-settings', 'smart-coin', 'smart-coin-rig', 'smart-hall-save', 'smart-halls-reset', 'guard-settings', 'guard-manual', 'firstbonus-settings', 'boost-settings']);

// One entry point for every change the admin screen can make. Every change that worked is written to the audit log.
export async function act(input) {
  const r = await perform(input);
  const action = String(input?.action ?? '');
  if (r.ok && LOGGED.has(action)) {
    const detail = ['userId', 'serial', 'op', 'decision', 'orderId', 'withdrawalId', 'planId', 'code', 'id', 'dir', 'mode', 'symbol', 'enabled', 'payout', 'scope', 'state', 'when', 'margin', 'buffer', 'amountBtc', 'amountUsd', 'note'].map((k) => input?.[k]).filter(Boolean).join(' · ');
    const extra = action === 'boost-settings' && input?.chance && typeof input.chance === 'object' ? `chance ${['t1', 't10', 't100'].map((k) => input.chance[k] ?? '-').join('/')}%` : '';
    const entry = { at: Date.now(), action, detail: [detail, extra].filter(Boolean).join(' · ').slice(0, 120) };
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

  if (action === 'charts-mock') {
    // The hashrate and uptime charts: made-up numbers (mock) or what the halls reported (real). See lib/server/telemetry.js.
    const mode = String(input?.mode ?? '');
    if (mode !== 'mock' && mode !== 'real') return fail(400, 'Choose mock or real.');
    await setMockCharts(mode === 'mock');
    return { ...done, mock: mode === 'mock' };
  }

  if (action === 'smart-settings') return saveSmartSettings(input);
  if (action === 'smart-coin') return setSmartCoin(input?.symbol, input?.enabled);
  if (action === 'smart-coin-rig') return setSmartCoinRig(input?.symbol, input);
  if (action === 'smart-hall-save') return saveSmartHall(input);
  if (action === 'smart-halls-reset') return resetSmartHalls();

  if (action === 'firstbonus-settings') return saveFirstBonusSettings(input);
  if (action === 'boost-settings') return saveBoostSettings(input);
  if (action === 'guard-settings') return saveGuardSettings(input);
  if (action === 'guard-manual') return setGuardManual(input);
  if (action === 'guard-backtest') return guardBacktest(input);

  if (action === 'demo-reset') return resetDemo();

  if (action === 'ref-settings') return saveSettings(input?.settings);
  if (action === 'ref-reset') return resetSettings();
  if (action === 'ref-test') {
    // Creates a test friend, links them to the inviter's code and starts a custom miner for them (th TH/s, default 15, for
    // days, default 90), so the whole reward flow can be tried.
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
    const r = await grantPlan(made, { planId: 'custom', th: input?.th ?? 15, days: input?.days ?? 90 });
    if (!r.ok) return r;
    return { ...done, friend: made };
  }

  if (action === 'hall-save') return saveHall(input);
  if (action === 'hall-delete') return deleteHall(input);
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

  if (action === 'miner' && input?.op === 'refund') return refundMiner(userId, String(input?.serial ?? ''));

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
