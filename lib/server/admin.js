// Admin access and platform actions. Storage lives in lib/server/db.js (shared by every server).
// Admin stays off until ADMIN_TOKEN (12 or more characters) is set in the environment.
// Signing in with that token sets a signed, httpOnly cookie that lasts 12 hours.
// The admin account and the audit log are meta entries "admin" and "adminlog"; sign-in throttling is shared in the database.
import { createHash, createHmac, randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { BTC_USD, halls as defaultHalls, hallFor } from '@/lib/data';
import { makeContract } from '@/lib/contracts';
import { normalizeGuard } from '@/lib/guard';
import { edgeAddress } from '@/lib/edge';
import { normalizeBoost, boostOn, giftBoost } from '@/lib/boost';
import {
  q, warm, metaGet, metaSet, metaUpdate, metaDelete, catalog, takeSerial, tx, allUsers, userExists, withUser, withUsers, usersIn, hydrate, createUser, saveUser, notify, peekSerial, ledger,
  clearFails as dbClearFails, hit as dbHit, release as dbRelease, botSend,
} from '@/lib/server/db';
import { grantPlan, adminOrderPage, reviewOrder } from '@/lib/server/miners';
import { adminWithdrawalPage, reviewWithdrawal } from '@/lib/server/withdrawals';
import { adminRefundPage, decideRefund, refundMinerInTx } from '@/lib/server/refund-requests';
import { availableIn, availableOf, TOLERANCE } from '@/lib/server/wallet';
import { getMarket } from '@/lib/server/market';
import { usedDays } from '@/lib/earnings';
import { getPrices } from '@/lib/server/prices';
import { mockCharts, setMockCharts, feedStatus } from '@/lib/server/telemetry';
import { showDemo, setShowDemo, reviewUrl, setReviewUrl, minDeposit, setMinDeposit, MIN_DEPOSIT_LOW, MIN_DEPOSIT_HIGH, minWithdraw, setMinWithdraw, MIN_WITHDRAW_LOW, MIN_WITHDRAW_HIGH } from '@/lib/server/flags';
import { signupGuard, saveSignupGuard } from '@/lib/server/signup-guard';
import { reviewList, saveReview, deleteReview, addMockReviews, clearMockReviews } from '@/lib/server/reviews';
import { farmVideos, saveFarmVideo, deleteFarmVideo, moveFarmVideo } from '@/lib/server/farm';
import { smartSettings, saveSmartSettings, smartCoinList, smartDayTable, setSmartCoin, setSmartCoinRig, smartHallList, saveSmartHall, resetSmartHalls } from '@/lib/server/smart-admin';
import { smartCost } from '@/lib/server/smart-market';
import { guardOverview, guardBacktest, saveGuardSettings, setGuardManual } from '@/lib/server/guard';
import { firstBonusSettings, saveFirstBonusSettings } from '@/lib/server/first-bonus';
import { boostSettings, saveBoostSettings, runningBoosts, forceBoostWin } from '@/lib/server/boost';
import { providerSettings, saveProvider } from '@/lib/server/pay-setting';
import { adminView, adminFriendPage, adminTicketPage, saveSettings, resetSettings, resolveCode, assignCode, applyLink, rewardBtcOf, settings as referralSettings } from '@/lib/server/referrals';
import { closeByAdmin, forgetSessions } from '@/lib/server/auth';
import { botConfig, broadcast, jobFor } from '@/lib/server/botnotify';
import { sendMail, mailEnabled } from '@/lib/server/auth';

// Mail from the support address (Resend; vertexhash.com is verified there). Replies go to the same address.
const SUPPORT_FROM = process.env.SUPPORT_FROM || 'Vertexhash Support <support@vertexhash.com>';
const SUPPORT_REPLY = process.env.SUPPORT_EMAIL || 'support@vertexhash.com';
import { startJob, control as controlJob, getJob, countWaiting, sendOne } from '@/lib/server/botqueue';
import { addReviewer, removeReviewer, reviewerList } from '@/lib/server/reviewers';

export const COOKIE = 'vtx_admin';
export const MAX_AGE = 12 * 3600; // seconds

const scrypt = promisify(scryptCb);
const secret = () => process.env.ADMIN_TOKEN || '';
export const adminEnabled = () => secret().length >= 12;

const sha = (s) => createHash('sha256').update(String(s)).digest();
const same = (a, b) => timingSafeEqual(sha(a), sha(b));
// A new admin password changes pwAt, which ends every older session.
const sign = (exp) => {
  const pwAt = metaGet('admin')?.pwAt;
  return createHmac('sha256', secret()).update(`vtx-admin:${exp}${pwAt ? `:${pwAt}` : ''}`).digest('hex');
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
// Same rule as auth.js clientIp: read x-forwarded-for from the right (TRUSTED_PROXIES, default 1).
export const clientIp = (req) => {
  const edge = edgeAddress(req.headers);
  if (edge) return edge;
  const hops = Math.max(1, Math.floor(Number(process.env.TRUSTED_PROXIES)) || 1);
  const parts = (req.headers.get('x-forwarded-for') || '').split(',').map((s) => s.trim()).filter(Boolean);
  return parts[parts.length - hops] || parts[parts.length - 1] || 'unknown';
};
export const clearFails = (ip) => dbClearFails(`admin:${ip}`);
// Counts the attempt first, in one statement, and says whether the address is now over the limit. giveBack() returns an attempt that was not a failure.
export const reserve = (ip) => dbHit(`admin:${ip}`, 5);
export const giveBack = (ip) => dbRelease(`admin:${ip}`);

// Signs worth a look, as short labels per user id. Only rules an admin can check by eye; a flag is a hint, never a verdict.
//  - Same network: three or more accounts signed up from the same network (a keyed hash, see netKeyOf in auth.js).
//  - Invite burst: four or more friends of one inviter joined within an hour.
//  - Quick withdrawal: a withdrawal within 48 hours of joining.
//  - Many withdrawals open: three or more at once.
// The test friends made by the admin tool (friendN@test) are left out.
export const FLAG = { netMin: 3, burstN: 4, burstMs: 3600000, fastMs: 48 * 3600000, openMin: 3 };
export function flaggedUsers(list, openWds = new Map()) {
  const out = new Map();
  const add = (id, label) => out.set(id, [...(out.get(id) || []), label]);
  const real = list.filter((u) => !u.closedAt && !/^friend\d+@test$/.test(u.id) && u.id !== 'demo');
  const nets = new Map();
  for (const u of real) if (u.netKey) nets.set(u.netKey, [...(nets.get(u.netKey) || []), u.id]);
  for (const ids of nets.values()) if (ids.length >= FLAG.netMin) for (const id of ids) add(id, `Same network ×${ids.length}`);
  const byInviter = new Map();
  for (const u of real) if (u.refBy && u.createdAt) byInviter.set(u.refBy, [...(byInviter.get(u.refBy) || []), u]);
  const burst = new Set();
  for (const mine of byInviter.values()) {
    const s = [...mine].sort((a, b) => a.createdAt - b.createdAt);
    for (let i = 0; i + FLAG.burstN - 1 < s.length; i += 1) {
      if (s[i + FLAG.burstN - 1].createdAt - s[i].createdAt <= FLAG.burstMs) for (let j = i; j < i + FLAG.burstN; j += 1) burst.add(s[j].id);
    }
  }
  for (const id of burst) add(id, 'Invite burst');
  for (const u of real) {
    if (u.createdAt && (u.history || []).some((h) => h.kind === 'withdrawal' && h.at && h.at - u.createdAt <= FLAG.fastMs)) add(u.id, 'Quick withdrawal');
    if ((openWds.get(u.id) || 0) >= FLAG.openMin) add(u.id, `${openWds.get(u.id)} withdrawals open`);
  }
  return out;
}

// The Orders, Withdrawals and Refunds lists are read a page at a time: GET /api/admin?list=orders|withdrawals|refunds&filter=open|all&offset=&limit=.
// Every answer carries exact counts (all rows, open rows), so nothing that needs a person can hide behind a cut-off.
export const LIST_PAGE = 20;
export const LIST_MAX = 200;
export function adminList(kind, input = {}) {
  const page = {
    open: input.filter === 'open',
    offset: Math.max(0, Math.floor(Number(input.offset)) || 0),
    limit: Math.min(LIST_MAX, Math.max(1, Math.floor(Number(input.limit)) || LIST_PAGE)),
  };
  if (kind === 'orders') return adminOrderPage(page);
  if (kind === 'deposits') return adminOrderPage({ ...page, deposit: true });
  if (kind === 'withdrawals') return adminWithdrawalPage(page);
  if (kind === 'refunds') return adminRefundPage(page);
  return null;
}

// The Referrals tab lists: GET /api/admin?list=friends|tickets&offset=&limit=. Admin only: /adtg never calls this, so a reviewer cannot read who invited whom.
export function adminRefList(kind, input = {}) {
  const page = {
    offset: Math.max(0, Math.floor(Number(input.offset)) || 0),
    limit: Math.min(LIST_MAX, Math.max(1, Math.floor(Number(input.limit)) || LIST_PAGE)),
  };
  if (kind === 'friends') return adminFriendPage(page);
  if (kind === 'tickets') return adminTicketPage(page);
  return null;
}

// The Users list, a page at a time: search, filter and order are applied here over every account, then one page is cut.
// GET /api/admin?list=users&q=&filter=&sort=&offset=&limit=. Rows are the same as the old full list, minus the activity rows
// (historyN says how many there are; adminUserHistory reads them when a user is opened).
export const USERS_PAGE = 20;
const kycRank = (u) => (u.kyc.status === 'pending' ? 2 : u.kyc.status === 'verified' ? 1 : 0);
const USER_SORT = {
  new: (a, b) => (b.joined || 0) - (a.joined || 0),
  bal: (a, b) => b.available - a.available,
  miners: (a, b) => b.miners.length - a.miners.length,
  seen: (a, b) => (b.lastIn || 0) - (a.lastIn || 0),
  kyc: (a, b) => kycRank(b) - kycRank(a),
};
const USER_FILTER = {
  all: () => true,
  blocked: (u) => !!u.blocked,
  frozen: (u) => !!u.frozen,
  unver: (u) => u.kyc.status !== 'verified',
  wd: (u) => u.withdrawalsOpen > 0,
  flag: (u) => u.flags.length > 0,
};
export async function adminUsers(input = {}) {
  const { users } = await cachedUsers();
  const needle = String(input.q ?? '').trim().toLowerCase().slice(0, 100);
  const filter = Object.hasOwn(USER_FILTER, input.filter) ? USER_FILTER[input.filter] : USER_FILTER.all;
  const sort = Object.hasOwn(USER_SORT, input.sort) ? USER_SORT[input.sort] : USER_SORT.new;
  const offset = Math.max(0, Math.floor(Number(input.offset)) || 0);
  const limit = Math.min(LIST_MAX, Math.max(1, Math.floor(Number(input.limit)) || USERS_PAGE));
  const hit = users.filter((u) => (!needle || `${u.id} ${u.tg ? `@${u.tg}` : ''}`.toLowerCase().includes(needle)) && filter(u)).sort(sort);
  return { all: users.length, shown: hit.length, rows: hit.slice(offset, offset + limit).map(({ history, ...u }) => ({ ...u, historyN: history.length })) };
}

// The latest activity rows of one account, for the History view. Null when there is no such open account.
export async function adminUserHistory(id) {
  const { users } = await cachedUsers();
  return users.find((u) => u.id === String(id ?? ''))?.history ?? null;
}

// The wallets of one account, for the admin user card: connected wallets (saved on connect, see app/api/account/wallet) and the
// addresses this account has withdrawn to. Admin only: /adtg never calls this. Null when there is no such account.
export async function adminUserWallets(id) {
  const uid = String(id ?? '');
  const row = (await q("SELECT data->'wallets' AS w FROM users WHERE id = $1", [uid])).rows[0];
  if (!row) return null;
  const connected = Array.isArray(row.w) ? row.w.slice(-10).reverse().map((x) => ({ address: String(x?.address || ''), chain: String(x?.chain || ''), at: Number(x?.at) || 0 })) : [];
  const sent = (await q("SELECT data->>'address' AS address, data->>'asset' AS asset, data->>'net' AS net, at FROM withdrawals WHERE user_id = $1 AND data->>'address' IS NOT NULL ORDER BY at DESC LIMIT 20", [uid])).rows;
  return { connected, withdrawals: sent.map((r) => ({ address: r.address, asset: r.asset || '', net: r.net || '', at: Number(r.at) || 0 })) };
}

const OPEN_ORDER = ['pending', 'review'];
const OPEN_WD = ['pending', 'approved'];
// How many rows of a table are open for each user (table names are fixed here, never from a request).
const openByUser = async (table, open) => new Map((await q(`SELECT user_id, count(*)::int AS n FROM ${table} WHERE status = ANY($1::text[]) GROUP BY user_id`, [open])).rows.map((r) => [r.user_id, r.n]));
// All rows and open rows of the lists (plan orders and deposits are counted apart), plus how many of each wait for a check.
async function listCounts() {
  const one = async (table, open, where = 'TRUE') => {
    const r = (await q(`SELECT count(*)::int AS n_all, count(*) FILTER (WHERE status = ANY($1::text[]))::int AS n_open FROM ${table} WHERE ${where}`, [open])).rows[0];
    return { all: r.n_all, open: r.n_open };
  };
  const [orders, deposits, withdrawals, refunds, review] = await Promise.all([
    one('orders', OPEN_ORDER, "coalesce(data->>'kind', '') <> 'deposit'"),
    one('orders', OPEN_ORDER, "data->>'kind' = 'deposit'"),
    one('withdrawals', OPEN_WD),
    one('refund_requests', ['pending']),
    q("SELECT count(*) FILTER (WHERE coalesce(data->>'kind', '') <> 'deposit')::int AS plan, count(*) FILTER (WHERE data->>'kind' = 'deposit')::int AS dep FROM orders WHERE status = 'review'"),
  ]);
  return { orders: { ...orders, review: review.rows[0].plan }, deposits: { ...deposits, review: review.rows[0].dep }, withdrawals, refunds };
}

// The accounts as the admin screen shows them, worked out in one pass over every account (there is no cut-off).
// The result is kept for a few seconds so the Users list can be read a page at a time without doing the pass again for each page;
// overview() always works it out fresh and replaces the copy.
const BUILD_TTL = 5000;
let built = null; // { at, p }
const freshUsers = () => {
  const mine = { at: Date.now(), p: buildUsers() };
  built = mine;
  mine.p.catch(() => {
    if (built === mine) built = null;
  });
  return mine.p;
};
const cachedUsers = () => (built && Date.now() - built.at < BUILD_TTL ? built.p : freshUsers());

async function buildUsers() {
  await warm(true);
  const list = await allUsers(null);
  const stats = { users: list.length, loaded: list.length, truncated: false, miners: 0, online: 0, th: 0, dailyUsd: 0, withdrawnBtc: 0, kycPending: 0, ordersReview: 0 };
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
  const market = await getMarket().catch(() => null);
  const nowMs = Date.now();
  const ctxs = new Map(); // one context per user, so the referral summary (cached per context) is worked out once for the balance and the reward
  const ctxOf = (u) => {
    let c = ctxs.get(u.id);
    if (!c) {
      c = { id: u.id, u, friends: friendsOf.get(u.id) || [], inviter: u.refBy ? byId.get(u.refBy) || null : null, S, market };
      ctxs.set(u.id, c);
    }
    return c;
  };
  const r8 = (n) => Math.round(n * 1e8) / 1e8;
  const availableBtc = (u) => r8(availableOf(ctxOf(u)));
  // How many orders and withdrawals each user still has open, and the totals of the three lists (the lists themselves are read by adminList).
  const [openOrders, openWds, counts] = await Promise.all([openByUser('orders', OPEN_ORDER), openByUser('withdrawals', OPEN_WD), listCounts()]);
  const flagsOf = flaggedUsers(list, openWds);
  const users = list.filter((u) => !u.closedAt).map((u) => {
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
    const available = availableBtc(u);
    const boosts = u.boosts || [];
    return {
      id: u.id,
      tg: u.tgUser || null,
      withdrawn: u.withdrawn || 0,
      adjust: u.adjust || 0,
      available,
      joined: u.createdAt || null,
      lastIn: u.lastIn || null,
      blocked: u.blocked || null,
      frozen: u.wdFrozen || null,
      flags: flagsOf.get(u.id) || [],
      // The latest 25 activity rows, for the History view.
      history: (u.history || []).slice(0, 25).map((h) => ({ at: h.at || null, date: h.date || '', kind: h.kind || '', label: h.label || '', amount: h.amount || '', coin: h.coin || '', status: h.status || '' })),
      note: u.adminNote || '',
      rating: u.rating || null, // private "Rate us" answer (lib/rating.js)
      twofa: !!u.twofa,
      hasPw: !!u.pw,
      deposited: r8(u.deposited || 0),
      spent: r8(u.spent || 0),
      // Mining, invite rewards and boosts: what is left after taking out the top-ups and admin changes.
      earned: r8(available + (u.withdrawn || 0) + (u.spent || 0) - (u.deposited || 0) - (u.adjust || 0)),
      reward: r8(rewardBtcOf(ctxOf(u))),
      refBy: u.refBy || null,
      invited: (friendsOf.get(u.id) || []).length,
      boostsRunning: boosts.filter((b) => nowMs < b.endsAt).length,
      boostWins: boosts.filter((b) => b.win && nowMs >= b.endsAt).length,
      ordersOpen: openOrders.get(u.id) || 0,
      withdrawalsOpen: openWds.get(u.id) || 0,
      kyc: { status: k.status, name: k.name, dob: k.dob, country: k.country, doc: k.doc, submittedAt: k.submittedAt, photos: k.photos },
      miners: u.contracts.map((c) => ({
        serial: c.serial,
        name: c.name,
        th: c.th,
        hall: c.hall,
        online: !!c.online,
        dailyUsd: c.dailyUsd,
        days: c.days,
        elapsed: Number.isFinite(c.startedAt) && Number.isFinite(c.elapsed) ? usedDays(c, nowMs, market?.guard) : c.elapsed,
        ends: c.ends,
      })),
    };
  });
  stats.ordersReview = counts.orders.review;
  stats.depositsReview = counts.deposits.review;
  stats.withdrawalsOpen = counts.withdrawals.open;
  stats.refundsOpen = counts.refunds.open;
  stats.th = Math.round(stats.th * 10) / 10;
  stats.dailyUsd = Math.round(stats.dailyUsd * 100) / 100;
  // Miners per hall, and the private "Rate us" answers: small summaries, so the screen needs no full list of accounts for them.
  const hallStat = {};
  for (const u of users) {
    for (const m of u.miners) {
      if (!m.hall) continue;
      const h = (hallStat[m.hall] = hallStat[m.hall] || { n: 0, on: 0 });
      h.n += 1;
      if (m.online) h.on += 1;
    }
  }
  const rated = users.filter((u) => u.rating).map((u) => ({ id: u.id, rating: u.rating })).sort((a, b) => (b.rating.at || 0) - (a.rating.at || 0));
  return { list, users, stats, counts, nowMs, hallStat, rated };
}

// Everything the admin screen shows, in one read. The accounts themselves are read a page at a time (adminUsers).
export async function overview() {
  const { list, stats, counts, nowMs, hallStat, rated } = await freshUsers();
  const [referrals, serial] = await Promise.all([adminView(), peekSerial()]);
  const { prices, source: priceSource } = await getPrices();
  const [mock, feed, smartSet, smartCoins, smartDays, smartHalls, guard, smartPower] = await Promise.all([mockCharts(), feedStatus(), smartSettings(), smartCoinList().catch(() => []), smartDayTable().catch(() => []), smartHallList(), guardOverview().catch(() => null), smartCost().catch(() => null)]);
  const firstBonus = await firstBonusSettings();
  const boost = await boostSettings();
  const payProvider = await providerSettings();
  const demoShown = await showDemo();
  const reviews = await reviewList();
  const farm = await farmVideos();
  const reviewPage = await reviewUrl();
  const minDep = await minDeposit();
  const minWd = await minWithdraw();
  const signupLimit = await signupGuard();
  return { demo: { show: demoShown }, signupLimit, reviews, farm, reviewUrl: reviewPage, minDeposit: minDep, minWithdraw: minWd, firstBonus, boost, boosts: runningBoosts(list, nowMs), payProvider, guard, smart: { settings: smartSet, coins: smartCoins, days: smartDays, cost: smartPower, halls: smartHalls }, stats, hallStat, rated, counts, log: (metaGet('adminlog') || []).slice(0, 30), reviewers: reviewerList(), catalog: catalog(), referrals, mode: 'postgres', btcUsd: BTC_USD, rate: { btc: prices.btc, source: priceSource }, serial, charts: { mock, feed } };
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
  const ids = (await q('SELECT id FROM users WHERE data->\'contracts\' @> $1::jsonb ORDER BY created_at, id', [JSON.stringify([{ hall: hallId }])])).rows.map((r) => r.id);
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
  const market = await getMarket(); // warms the market cache now, so nothing slow happens while the account is locked
  return withUser(userId, async (u, c) => {
    if (!u) return fail(404, 'User not found.');
    if (signed < 0 && btc > (await availableIn(c, u, market)) + TOLERANCE) return fail(409, 'More than the available balance of this user.');
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
    notify(u, { kind: 'news', title: 'Balance updated', body: `${signed > 0 ? '+' : '-'}${btc.toFixed(8)} BTC was ${signed > 0 ? 'added to' : 'taken from'} your balance by support.`, code: signed > 0 ? 'balAdd' : 'balSub', vars: { btc: `${signed > 0 ? '+' : '-'}${btc.toFixed(8)}` } });
    await ledger(c, userId, 'adjust', {
      btc: signed,
      ...(usd ? { usd: signed > 0 ? usd : -usd } : {}),
      ref: usd ? `${note} · $${usd.toFixed(2)} at $${rate}/BTC` : note,
    });
    return { ...done, adjust: u.adjust, btc, ...(usd ? { usd, rate, rateSource } : {}) };
  });
}

// A gift from support, free of charge. kind 'miner': a gift miner (th TH/s for days days, marked bonus like the welcome gift, so it has no
// price, cannot be refunded and does not count as a purchase). kind 'tickets': count free $1 boost tickets, held in the account (u.freeTickets)
// like an invite gift; the user starts each one from the Boost page. The user is told in their notifications.
export const GIFT_MAX = { th: 1000, days: 365, tickets: 10 };
export const BULK_MAX = 200; // users in one bulk action
// The Telegram message for a gift (nothing for an account with no Telegram). A fresh key each time: a second gift is a second message.
const giftBot = (u, code, vars) => botSend(jobFor(u, { id: `gf${Date.now().toString(36)}${randomBytes(5).toString('hex')}`, code, vars }));
async function giftTo(userId, input) {
  const kind = String(input?.kind ?? '');
  if (userId === 'demo') return fail(409, 'The demo account cannot be changed here.');
  if (kind === 'tickets') {
    const n = Math.floor(num(input?.count));
    if (!(n >= 1 && n <= GIFT_MAX.tickets)) return fail(422, `Give 1 to ${GIFT_MAX.tickets} tickets.`);
    await warm(true);
    const cfg = normalizeBoost(metaGet('boost'));
    if (!boostOn(cfg)) return fail(409, 'Boost tickets are off. Turn them on in the Boosts tab first.');
    return withUser(userId, (u) => {
      if (!u) return fail(404, 'User not found.');
      u.freeTickets = (u.freeTickets || 0) + n; // held until the user uses them (lib/server/boost.js buyBoost with free: true)
      notify(u, { kind: 'news', title: 'Free tickets', body: `Support gave you ${n} free boost ticket${n === 1 ? '' : 's'}.` });
      giftBot(u, 'giftTickets', { n });
      return { ...done, count: n };
    });
  }
  if (kind === 'miner') {
    const th = num(input?.th);
    const days = Math.floor(num(input?.days));
    if (!(th >= 1 && th <= GIFT_MAX.th)) return fail(422, `Power must be 1 to ${GIFT_MAX.th} TH/s.`);
    if (!(days >= 1 && days <= GIFT_MAX.days)) return fail(422, `Term must be 1 to ${GIFT_MAX.days} days.`);
    await getMarket(); // warms the market cache now, so nothing slow happens while the account is locked
    return withUser(userId, async (u, c) => {
      if (!u) return fail(404, 'User not found.');
      const hall = hallFor(th);
      const m = {
        ...makeContract({ name: 'Gift', th, hall, days, daily: `$${(th * catalog().halls[hall].net).toFixed(2)}`, price: 0 }, await takeSerial(c)),
        bonus: true,
        pauseRule: normalizeGuard(metaGet('guard')).mode, // what a paused day does to its term, as the admin has it now
      };
      u.contracts.push(m);
      notify(u, { kind: 'news', title: 'Free miner', body: `Support gave you ${th} TH/s for ${days} days (${m.serial}).` });
      giftBot(u, 'giftMiner', { th, days });
      return { ...done, serial: m.serial };
    });
  }
  return fail(400, 'Choose a miner or tickets.');
}

// A full refund, the one the Terms promise: within 24 hours of the miner starting and before its first payout day has
// finished (payout days run 00:00 to 24:00 UTC, see earnings.js). Only miners that were paid for (balance or crypto)
// qualify, never admin grants, welcome gifts or the demo account. The miner is removed, so whatever it had accrued goes
// with it, and its price is credited back as a signed balance entry in BTC at the live rate; the ledger row keeps the USD
// and the rate. If that was the buyer's last paid miner, their welcome gift goes too, so a refund cannot keep the gift.
// The account row is locked, so two refunds of the same miner cannot both pay out. `now` is only for tests.
// The work itself lives in refundMinerInTx (lib/server/refund-requests.js), so approving a request can run it on an
// account it already locked instead of opening a second transaction for it.
export async function refundMiner(userId, serial, now = Date.now()) {
  const rate = (await getPrices()).prices.btc;
  if (!(rate > 0)) return fail(503, 'No BTC price is available right now. Try again in a moment.');
  return withUser(userId, (u, c) => refundMinerInTx(u, c, serial, rate, now));
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

// A hall can go only when nothing points at it: no miner, no open order. The checks run on the transaction client
// under the catalogue lock, so a miner or an order cannot slip in between the check and the delete.
function deleteHall(input) {
  const id = String(input?.id ?? '');
  return tx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['meta:catalog']);
    const row = await c.query('SELECT data FROM meta WHERE key = $1', ['catalog']);
    const cat = structuredClone(row.rows[0]?.data || { halls: defaultHalls });
    delete cat.plans; // the fixed plans are gone; an older saved catalogue may still carry them
    if (!Object.hasOwn(cat.halls, id)) return fail(404, 'Hall not found.');
    if (CORE_HALLS.has(id)) return fail(409, 'This hall sets the price of custom power, so it can be edited but not removed.');
    if ((await c.query('SELECT 1 FROM users WHERE data->\'contracts\' @> $1::jsonb LIMIT 1', [JSON.stringify([{ hall: id }])])).rowCount) return fail(409, 'Miners are running in this hall.');
    if ((await c.query("SELECT 1 FROM orders WHERE status IN ('pending', 'review') AND data->'plan'->>'hall' = $1 LIMIT 1", [id])).rowCount) return fail(409, 'An open order uses this hall.');
    delete cat.halls[id];
    await metaSet('catalog', cat, c);
    return done;
  }).then(async (r) => {
    if (r.ok) await warm(true).catch(() => {}); // the local copy follows the committed delete
    return r;
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

const LOGGED = new Set(['notify', 'tg-broadcast', 'email-send', 'tg-notices', 'ref-settings', 'ref-reset', 'ref-test', 'hall-save', 'hall-delete', 'catalog-reset', 'kyc', 'miners-clear', 'miner', 'order', 'withdrawal', 'balance', 'admin-password', 'charts-mock', 'demo-reset', 'demo-show', 'signup-guard', 'min-deposit', 'min-withdraw', 'review-save', 'review-delete', 'review-mock', 'review-mock-clear', 'review-url', 'farm-save', 'farm-delete', 'farm-move', 'smart-settings', 'smart-coin', 'smart-coin-rig', 'smart-hall-save', 'smart-halls-reset', 'guard-settings', 'guard-manual', 'firstbonus-settings', 'boost-settings', 'boost-win', 'pay-provider', 'user', 'gift', 'bulk', 'refund-request', 'user-close', 'reviewer-add', 'reviewer-remove']);

// One entry point for every change the admin screen can make. Every change that worked is written to the audit log.
// The log write is best-effort: the action already happened, so a log failure must not surface as a failed action —
// an admin retrying a "failed" balance change or gift would apply it a second time. A crash between the action and
// the write still leaves the action unlogged; folding each entry into its action's own transaction is the fuller fix.
// Entries kept in the audit log. One bulk action adds up to BULK_MAX entries of its own (one per user), so the log must hold
// well more than that or a single bulk would push all the older history out.
const LOG_MAX = 500;
async function writeLog(entries) {
  if (!entries.length) return;
  try {
    await metaUpdate('adminlog', (cur) => ({ value: [...entries, ...(cur || [])].slice(0, LOG_MAX) }));
  } catch {}
}

// The audit-log entry for an action that worked, or null when that action is not logged.
function logEntry(input) {
  const action = String(input?.action ?? '');
  if (action === 'tg-notices' && ['status', 'count'].includes(String(input?.op ?? ''))) return null; // reads are not changes
  if (LOGGED.has(action)) {
    const detail = ['userId', 'serial', 'op', 'decision', 'orderId', 'withdrawalId', 'planId', 'code', 'id', 'dir', 'mode', 'symbol', 'enabled', 'payout', 'scope', 'state', 'when', 'margin', 'buffer', 'smartFloor', 'amountBtc', 'amountUsd', 'perDay', 'usd', 'note', 'provider', 'kind', 'count', 'inviter', 'source'].map((k) => input?.[k]).filter(Boolean).join(' · ');
    const many = Array.isArray(input?.ids) ? `${input.ids.length} users` : '';
    const chance = action === 'boost-settings' && input?.chance && typeof input.chance === 'object' ? `chance ${['t1', 't10', 't100'].map((k) => input.chance[k] ?? '-').join('/')}%` : '';
    const extra = [many, chance].filter(Boolean).join(' · ');
    const entry = { at: Date.now(), action, detail: [detail, extra].filter(Boolean).join(' · ').slice(0, 120) };
    return entry;
  }
  return null;
}

export async function act(input) {
  const r = await perform(input);
  const entry = r.ok ? logEntry(input) : null;
  if (entry) await writeLog([entry]);
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
    if (userId === 'all') {
      // Every account: queued and sent in small batches in the background (lib/server/botqueue.js), so one click does not press the servers.
      const r = await startJob({ type: 'news', title, body });
      return r.ok ? { ...done, sent: 0, queued: r.job.total } : r;
    }
    const ids = (await userExists(userId)) ? [userId] : [];
    if (!ids.length) return fail(404, 'User not found.');
    for (let i = 0; i < ids.length; i += 100) {
      await withUsers(ids.slice(i, i + 100), (map) => {
        for (const u of map.values()) notify(u, { kind: 'news', title, body });
      });
    }
    return { ...done, sent: ids.length };
  }

  if (action === 'tg-notices') {
    // The old friend-joined and gift notices the bot never got (lib/server/botqueue.js). status/count read; send-one sends now; send-all starts the batch job.
    const op = String(input.op ?? '');
    if (op === 'status') return { ...done, job: await getJob() };
    if (op === 'count') return { ...done, ...(await countWaiting()), job: await getJob() };
    if (op === 'send-one') return sendOne(userId);
    if (op === 'send-all') {
      if (!botConfig()) return fail(503, 'Telegram bot is off.');
      const r = await startJob({ type: 'notices' });
      return r.ok ? { ...done, job: r.job } : r;
    }
    if (op === 'pause' || op === 'resume' || op === 'cancel') return controlJob(op);
    return fail(400, 'Unknown action.');
  }

  if (action === 'tg-broadcast') {
    // Telegram news through the bot service. mode 'test' sends one message to testId; 'all' queues it for every chat with news on.
    const mode = String(input.mode ?? '');
    const text = String(input.text ?? '').trim();
    const textFa = String(input.textFa ?? '').trim();
    if (mode !== 'test' && mode !== 'all') return fail(400, 'Choose test or send.');
    if (!text) return fail(422, 'Write the English text.');
    if (text.length > 1000 || textFa.length > 1000) return fail(422, 'Text is too long (1000 characters).');
    let testId = null;
    if (mode === 'test') {
      testId = Number(String(input.testId ?? '').trim().replace(/^tg:/, ''));
      if (!Number.isSafeInteger(testId) || testId <= 0) return fail(422, 'Enter your Telegram ID.');
    }
    const cfg = botConfig();
    if (!cfg) return fail(503, 'Telegram bot is off.');
    const r = await broadcast({ id: `a${Date.now().toString(36)}${randomBytes(6).toString('hex')}`, en: text, fa: textFa, test_tg_id: testId }, cfg);
    if (!r.ok) return fail(502, r.status === 0 ? 'The bot did not answer.' : r.status === 503 ? 'The bot queue is full. Try later.' : 'The bot refused the message.');
    return { ...done, mode, queued: Number(r.json?.queued) || 0 };
  }

  if (action === 'email-send') {
    // Email from the support address. mode 'test' mails one address typed in; mode 'one' mails a user whose email is verified.
    const mode = String(input.mode ?? '');
    const subject = text(input.subject, 120);
    const body = String(input.text ?? '').trim();
    if (mode !== 'test' && mode !== 'one' && mode !== 'all') return fail(400, 'Choose test, one user or all.');
    if (!subject) return fail(422, 'Add a subject.');
    if (!body) return fail(422, 'Write the message.');
    if (body.length > 5000) return fail(422, 'Message is too long (5000 characters).');
    if (!mailEnabled()) return fail(503, 'Email is not set up (RESEND_API_KEY, MAIL_FROM).');
    if (mode === 'all') {
      // Every account with a verified email: queued and sent in small batches in the background (lib/server/botqueue.js).
      const r = await startJob({ type: 'email', title: subject, body });
      return r.ok ? { ...done, mode, queued: r.job.total } : r;
    }
    let to = '';
    if (mode === 'test') {
      to = String(input.to ?? '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return fail(422, 'Enter a valid email address.');
    } else {
      const row = (await q("SELECT data->>'email' AS email, data->>'emailVerified' AS verified FROM users WHERE id = $1", [userId])).rows[0];
      if (!row) return fail(404, 'User not found.');
      if (!row.email || row.verified !== 'true') return fail(422, 'That user has no verified email.');
      to = row.email;
    }
    try {
      await sendMail(to, subject, body, { from: SUPPORT_FROM, replyTo: SUPPORT_REPLY });
    } catch {
      return fail(502, 'The mail provider refused the message.');
    }
    return { ...done, mode, sent: 1 };
  }

  if (action === 'admin-password') {
    const a = metaGet('admin');
    const next = String(input?.next ?? '');
    if (!a || !(await checkLogin(a.user, input?.current))) return fail(401, 'Current password is wrong.');
    if (next.length < 10 || next.length > 200) return fail(422, 'New password must be at least 10 characters.');
    const salt = randomBytes(16).toString('hex');
    const hash = await hashPw(next, salt);
    // Verify-and-set under the lock, against the record as it is now: the check above read a copy up to 3 s old,
    // so two changes at once (or one from another server) could otherwise both pass and the second would silently win.
    const r = await metaUpdate('admin', async (cur) => {
      if (!cur || !same(await hashPw(String(input?.current ?? '').slice(0, 200), cur.salt), cur.hash)) {
        return { result: fail(409, 'The current password no longer matches. Sign in again and try once more.') };
      }
      return { value: { ...cur, salt, hash, pwAt: Date.now() }, result: done };
    });
    if (!r.ok) return r;
    return { ...done, session: newSession() };
  }

  if (action === 'charts-mock') {
    // The hashrate and uptime charts: made-up numbers (mock) or what the halls reported (real). See lib/server/telemetry.js.
    const mode = String(input?.mode ?? '');
    if (mode !== 'mock' && mode !== 'real') return fail(400, 'Choose mock or real.');
    await setMockCharts(mode === 'mock');
    return { ...done, mock: mode === 'mock' };
  }

  if (action === 'demo-show') {
    // The "Explore the demo first" button on the sign-in sheet. See lib/server/flags.js.
    if (typeof input?.enabled !== 'boolean') return fail(400, 'Choose show or hide.');
    await setShowDemo(input.enabled);
    return { ...done, show: input.enabled };
  }

  // New accounts one network may open in 24 hours, with an on/off switch (lib/server/signup-guard.js).
  if (action === 'signup-guard') return saveSignupGuard(input);

  if (action === 'review-save') return saveReview(input);
  if (action === 'review-delete') return deleteReview(input?.id);
  if (action === 'review-mock') return addMockReviews();
  if (action === 'review-mock-clear') return clearMockReviews();
  if (action === 'farm-save') return saveFarmVideo(input);
  if (action === 'farm-delete') return deleteFarmVideo(input?.id);
  if (action === 'farm-move') return moveFarmVideo(input?.id, String(input?.dir ?? ''));
  if (action === 'review-url') {
    // The public review page shown after a user rates the app (lib/server/flags.js). Empty removes it.
    const url = String(input?.url ?? '').trim();
    let bad = url.length > 300 || (!!url && !/^https:\/\//i.test(url));
    if (url && !bad) {
      try {
        new URL(url);
      } catch {
        bad = true;
      }
    }
    if (bad) return fail(422, 'The link must start with https://');
    await setReviewUrl(url);
    return { ...done, url };
  }

  if (action === 'min-deposit') {
    // The smallest wallet top-up in dollars (lib/server/flags.js). Empty puts back the default.
    const raw = String(input?.usd ?? '').trim();
    if (!raw) return { ...done, usd: await setMinDeposit(null) };
    const usd = Math.round(num(raw) * 100) / 100;
    if (!(usd >= MIN_DEPOSIT_LOW && usd <= MIN_DEPOSIT_HIGH)) return fail(422, `Enter an amount from $${MIN_DEPOSIT_LOW} to $${MIN_DEPOSIT_HIGH}.`);
    return { ...done, usd: await setMinDeposit(usd) };
  }

  if (action === 'min-withdraw') {
    // The smallest withdrawal in dollars of the coin withdrawn (lib/server/flags.js). Empty puts back the default.
    const raw = String(input?.usd ?? '').trim();
    if (!raw) return { ...done, usd: await setMinWithdraw(null) };
    const usd = Math.round(num(raw) * 100) / 100;
    if (!(usd >= MIN_WITHDRAW_LOW && usd <= MIN_WITHDRAW_HIGH)) return fail(422, `Enter an amount from $${MIN_WITHDRAW_LOW} to $${MIN_WITHDRAW_HIGH}.`);
    return { ...done, usd: await setMinWithdraw(usd) };
  }

  if (action === 'smart-settings') return saveSmartSettings(input);
  if (action === 'smart-coin') return setSmartCoin(input?.symbol, input?.enabled);
  if (action === 'smart-coin-rig') return setSmartCoinRig(input?.symbol, input);
  if (action === 'smart-hall-save') return saveSmartHall(input);
  if (action === 'smart-halls-reset') return resetSmartHalls();

  if (action === 'firstbonus-settings') return saveFirstBonusSettings(input);
  if (action === 'boost-settings') return saveBoostSettings(input);
  if (action === 'pay-provider') return saveProvider(input);
  if (action === 'guard-settings') return saveGuardSettings(input);
  if (action === 'guard-manual') return setGuardManual(input);
  if (action === 'guard-backtest') return guardBacktest(input);

  // View-only accounts for /adtg (lib/server/reviewers.js). The name travels as id, so the audit log shows it; the password is never logged.
  if (action === 'reviewer-add') return addReviewer(input?.id, input?.pass);
  if (action === 'reviewer-remove') return removeReviewer(input?.id);

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
    // The guard and the delete run in one transaction under the catalogue lock (the same lock the catalogue
    // writers take), so a hall save cannot slip in between the check and the delete and resurrect the old catalogue.
    // metaUpdate cannot be used here: its callback is not given the transaction client, so the guard could not run on it.
    const before = await tx(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['meta:catalog']);
      const row = await c.query('SELECT data FROM meta WHERE key = $1', ['catalog']);
      const halls = row.rows[0]?.data?.halls || defaultHalls;
      const custom = await c.query("SELECT 1 FROM users WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(data->'contracts') k WHERE k->>'hall' <> ALL($1::text[])) LIMIT 1", [[...CORE_HALLS]]);
      if (custom.rowCount) return null;
      await metaDelete('catalog', c);
      return halls;
    });
    if (!before) return fail(409, 'Miners are running in a hall you added. Remove them or keep the halls.');
    await warm(true).catch(() => {}); // the local copy follows the committed delete
    const after = defaultHalls;
    let updated = 0;
    for (const id of Object.keys(after)) if (before[id]?.net !== after[id].net) updated += await applyRate(id, after[id].net);
    return { ...done, updated };
  }

  // The same change for several users, one after the other. Each one goes through the single-user action, so every rule there still applies;
  // a user it refuses is counted and named, the rest go on. The demo account is always skipped.
  if (action === 'bulk') {
    const ids = [...new Set((Array.isArray(input?.ids) ? input.ids : []).map((v) => String(v)).filter((v) => v && v !== 'demo' && v !== 'all'))];
    if (!ids.length) return fail(422, 'Pick at least one user.');
    if (ids.length > BULK_MAX) return fail(422, `Up to ${BULK_MAX} users at a time.`);
    const op = String(input?.op ?? '');
    // Each user goes through perform(), so every rule of the single-user action applies, and every user's change still gets its
    // own audit-log entry naming them. The entries are written in one log update at the end (newest first), not one per user;
    // the 'bulk' entry act() adds afterwards only says how many were touched.
    const step = {
      block: (id) => ({ action: 'user', userId: id, op: 'block' }),
      unblock: (id) => ({ action: 'user', userId: id, op: 'unblock' }),
      freeze: (id) => ({ action: 'user', userId: id, op: 'freeze' }),
      unfreeze: (id) => ({ action: 'user', userId: id, op: 'unfreeze' }),
      notify: (id) => ({ action: 'notify', userId: id, title: input?.title, body: input?.body }),
      tickets: (id) => ({ action: 'gift', userId: id, kind: 'tickets', count: input?.count }),
    }[op];
    if (!step) return fail(400, 'Unknown operation.');
    let ok = 0;
    const errors = [];
    const entries = [];
    for (const id of ids) {
      const sub = step(id);
      const r = await perform(sub);
      if (r.ok) {
        ok += 1;
        const e = logEntry(sub);
        if (e) entries.unshift(e);
      } else errors.push(`${id}: ${r.error}`);
    }
    await writeLog(entries);
    return { ...done, done: ok, failed: errors.length, errors: errors.slice(0, 3) };
  }

  if (!(await userExists(userId))) return fail(404, 'User not found.');

  if (action === 'user-close') {
    if (String(input?.confirm ?? '').trim().toUpperCase() !== 'DELETE') return fail(422, 'Type DELETE to confirm.');
    return closeByAdmin(userId);
  }

  if (action === 'boost-win') return forceBoostWin(userId, String(input?.id ?? ''));

  if (action === 'order') {
    const r = await reviewOrder(userId, input?.orderId, String(input?.decision ?? ''));
    return r.ok ? { ...done, serial: r.serial } : r;
  }

  if (action === 'withdrawal') return reviewWithdrawal(userId, input?.withdrawalId, String(input?.decision ?? ''), input?.txid);

  if (action === 'refund-request') return decideRefund(userId, String(input?.id ?? ''), String(input?.decision ?? ''), input?.note);

  if (action === 'kyc') {
    return withUser(userId, (u) => {
      if (!u) return fail(404, 'User not found.');
      if (u.kyc.status !== 'pending') return fail(409, 'Nothing to review.');
      if (input.decision === 'approve') {
        u.kyc = { ...u.kyc, status: 'verified', reviewedAt: Date.now() };
        notify(u, { kind: 'news', title: 'Identity verified', body: 'Your verification was approved.', code: 'kycOk' });
      } else if (input.decision === 'reject') {
        // Back to "none" so the person can submit again.
        u.kyc = { status: 'none', rejectedAt: Date.now() };
        notify(u, { kind: 'news', title: 'Verification not approved', body: 'Check your details and submit again.', code: 'kycNo' });
      } else {
        return fail(400, 'Unknown decision.');
      }
      return done;
    });
  }

  if (action === 'balance') return adjustBalance(userId, input);

  if (action === 'gift') return giftTo(userId, input);

  // Block, note, reset and verify: small changes to one account, each one logged (op and note show in the audit log).
  if (action === 'user') {
    const op = String(input?.op ?? '');
    if (!['block', 'unblock', 'freeze', 'unfreeze', 'note', 'reset-sessions', 'reset-2fa', 'verify', 'unverify', 'set-password', 'ref-set', 'ref-clear'].includes(op)) return fail(400, 'Unknown operation.');
    if (userId === 'demo') return fail(409, 'The demo account cannot be changed here.');
    // A new password is hashed, and an inviter is looked up and checked, before the account is locked. The password is never logged.
    let pw = null;
    if (op === 'set-password') {
      const next = String(input?.password ?? '');
      if (next.length < 8 || next.length > 200) return fail(422, 'Password needs 8 to 200 characters.');
      const salt = randomBytes(16).toString('hex');
      pw = { salt, hash: await hashPw(next, salt) };
    }
    let inv = null;
    if (op === 'ref-set') {
      const want = String(input?.inviter ?? '').trim();
      if (!want) return fail(422, 'Enter the inviter (email, account id or invite code).');
      const row = (await q("SELECT u.id, u.data->>'refCode' AS code, (u.data->>'closedAt') IS NOT NULL AS closed FROM users u WHERE u.id = lower($1) OR u.data->>'email' = lower($1) OR u.id = (SELECT user_id FROM codes WHERE code = upper($1)) LIMIT 1", [want])).rows[0];
      if (!row) return fail(404, 'Inviter not found.');
      if (row.closed) return fail(409, 'That account is closed.');
      if (row.id === userId) return fail(409, 'An account cannot invite itself.');
      // Walk up the inviter's own chain: the user must not be in it, or invites would run in a circle.
      let up = row.id;
      for (let i = 0; i < 20 && up; i += 1) {
        if (up === userId) return fail(409, 'That would make a circle of invites.');
        up = (await q('SELECT ref_by FROM users WHERE id = $1', [up])).rows[0]?.ref_by || null;
      }
      inv = { id: row.id, code: row.code || '' };
    }
    const out = await withUser(userId, (u) => {
      if (!u) return fail(404, 'User not found.');
      if (op === 'block') u.blocked = Date.now(); // sessions and sign-in stop at once (lib/server/auth.js)
      else if (op === 'unblock') delete u.blocked;
      else if (op === 'freeze') u.wdFrozen = Date.now(); // withdrawals are refused (lib/server/wallet.js); sign-in and the rest keep working
      else if (op === 'unfreeze') delete u.wdFrozen;
      else if (op === 'note') {
        const t = text(input?.note, 200);
        if (t) u.adminNote = t;
        else delete u.adminNote;
      } else if (op === 'reset-sessions') u.pwAt = Date.now(); // every older session stops matching
      else if (op === 'reset-2fa') {
        if (!u.twofa) return fail(409, 'Two-factor is not on.');
        delete u.twofa;
        delete u.twofaPending;
        notify(u, { kind: 'news', title: 'Two-factor is off', body: 'Sign-in no longer asks for a code.', code: 'tfOff' });
      } else if (op === 'set-password') {
        if (!u.pw) return fail(409, 'This account has no password (it signs in with Telegram).');
        u.pw = pw;
        u.pwAt = Date.now(); // every older session stops matching
        delete u.reset;
        notify(u, { kind: 'news', title: 'Password changed', body: 'Other devices were signed out.', code: 'pwChanged' });
      } else if (op === 'ref-set') {
        // Rewards are worked out on read from the friend's own record, so linking again carries what the friend already did.
        u.refBy = inv.id;
        u.refAt = Date.now();
        u.refUsed = inv.code;
        u.refRebate = 0;
      } else if (op === 'ref-clear') {
        if (!u.refBy) return fail(409, 'No inviter to remove.');
        delete u.refBy;
        delete u.refAt;
        delete u.refUsed;
        delete u.refRebate;
      } else if (op === 'verify') u.kyc = { ...u.kyc, status: 'verified', reviewedAt: Date.now() };
      else u.kyc = { status: 'none' };
      return done;
    });
    forgetSessions(userId); // a block, session reset or password change takes effect on this server at once
    return out;
  }

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
