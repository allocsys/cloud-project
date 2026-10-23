// Plan catalogue, the user's miners, buying a plan and paying for it. Storage lives in lib/server/db.js.
// Ways to pay:
//   balance  takes the price from the user's mining and invite balance (BTC at the live rate) and activates at once.
//   crypto   opens a hosted invoice (lib/server/pay-provider.js). The miner starts only when the provider reports the
//            payment finished, through settleOrder() from the signed callback.
//   The demo account pays the same way, so staging tests the real flow.
//
// Concurrency: a purchase locks the buyer and, when there is one, their inviter (sorted by id) before it checks the
// balance and writes, so any number of servers can sell at the same time without double spending or double activating.
// Lock order everywhere: accounts first, then an order row. Network calls (the invoice) never happen inside a lock.
import { randomBytes } from 'node:crypto';
import { CUSTOM, customPlan } from '@/lib/data';
import { makeContract } from '@/lib/contracts';
import { resolveSmart, ratioOf, pickCoin } from '@/lib/smart';
import { pool, q, getUser, withUsers, withUser, withIdem, idemGet, ledger, notify, catalog, takeSerial, peekSerial } from '@/lib/server/db';
import { onPurchase } from '@/lib/server/referrals';
import { smartSettings } from '@/lib/server/smart-admin';
import { getPrices } from '@/lib/server/prices';
import { getMarket } from '@/lib/server/market';
import { refreshPricing, pricedHalls } from '@/lib/server/pricing';
import { withLiveDaily, minerDaily, startOf, stopOf } from '@/lib/earnings';
import { minerCharts } from '@/lib/telemetry';
import { smartRateAt, smartMachineNow } from '@/lib/smart-halls';
import { guardSettings } from '@/lib/server/guard';
import { isPaused, scopeOf, termEnd } from '@/lib/guard';
import { telemetryFor } from '@/lib/server/telemetry';
import { availableIn, TOLERANCE } from '@/lib/server/wallet';
import { cryptoEnabled, createInvoice } from '@/lib/server/pay-provider';

const MAX_PENDING = 3;
const PENDING_DAYS = 3;
const SETUP_GRACE_MS = 120_000; // an order whose invoice was never created after this long is abandoned

// The catalogue as buyers see it: the hall net rates follow the live market (see lib/pricing.js). Await refreshPricing() first.
export const getCatalog = () => {
  const cat = catalog();
  return { ...cat, halls: pricedHalls(cat.halls) };
};

// A Smart Mining miner can carry the "Renew at term end" switch while its term is still running and it has not renewed yet.
const withRenewable = (list, market, now = Date.now()) =>
  list.map((c) => (c.smart && !c.renewedTo && now < termEnd(c, startOf(c, now), market?.guard) ? { ...c, renewable: true } : c));

// `nextSerial` is only a preview for the buy sheet; the real serial is assigned at purchase.
// dailyUsd on each miner is what it is expected to pay today at the live market (its static value when there is none).
export async function getMiners(userId = 'demo') {
  const [u, nextSerial, market] = await Promise.all([getUser(userId), peekSerial(), getMarket()]);
  return { contracts: withRenewable(withLiveDaily(u.contracts, market), market), nextSerial };
}

// Smart Mining: the coin it is on today (the live best, held inside the hysteresis) and the coin of each recent finished day, newest first.
function smartCoins(sm) {
  if (!sm) return null;
  const ratios = {};
  for (const [coin, g] of Object.entries(sm.live || {})) ratios[coin] = ratioOf(g, sm.refs?.[coin]);
  const today = pickCoin(ratios, sm.prev) || sm.prev || null;
  const days = Object.keys(sm.picks || {}).map(Number).sort((a, b) => b - a).slice(0, 14);
  const label = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return { today, history: days.map((d) => ({ day: label(d), coin: sm.picks[d] })) };
}

// One miner with its finished payout days (daily, newest first), the BTC they came to (earnedBtc), and its charts:
// charts = { real, hash: { series (24 hourly TH/s), now, hasData }, uptime: { series: [{ label, day, pct }], pct } }.
// A Smart Mining miner also gets machine = { coin, hall, unit, rate }, what it runs on today, and its hashrate charts are in
// that coin's unit (lib/smart-halls.js).
export async function getMiner(serial, userId = 'demo') {
  const [u, market] = await Promise.all([getUser(userId), getMarket()]);
  const c = u.contracts.find((x) => x.serial === serial);
  if (!c) return null;
  const now = Date.now();
  const d = minerDaily(c, now, market);
  const start = startOf(c, now);
  const tel = await telemetryFor([c], now);
  const rateAt = c.smart ? (h) => smartRateAt(c, market.smart, h, now) : null;
  const off = market.guard ? (h) => isPaused(market.guard, scopeOf(c), Math.floor(h / 86400000) * 86400000) : null;
  const charts = minerCharts(c, start, stopOf(c, start, now, market.guard), tel ? tel.samples[c.serial] || [] : null, now, rateAt, off);
  const machine = c.smart ? smartMachineNow(c, market.smart, now) : null;
  return { ...withRenewable(withLiveDaily([c], market), market)[0], daily: d.rows, earnedUsd: d.usd, earnedBtc: d.btc, charts, ...(c.smart ? { machine, coins: smartCoins(market.smart) } : {}) };
}

const fail = (status, error) => ({ ok: false, status, error });
const cents = (n) => Math.round(n * 100) / 100;
const planLabel = (p) => (p.id === 'custom' ? `Custom ${p.th} TH/s` : p.id === 'smart' ? `Smart Mining $${p.price}` : `${p.name} plan`);

function resolvePlan(input, smartSt = null) {
  if (input?.planId === 'smart') return resolveSmart(input, smartSt?.table);
  if (input?.planId === 'custom') {
    const th = Number(input.th);
    const days = Number(input.days);
    if (!Number.isFinite(th) || th < CUSTOM.min || th > CUSTOM.max || !Number.isInteger(th * 2) || !CUSTOM.terms.includes(days)) return null;
    return customPlan(th, days, getCatalog().halls);
  }
  return null;
}

// Locks the buyer and their inviter, then runs fn(buyer, inviter, client).
async function withBuyer(userId, fn) {
  const pre = await getUser(userId);
  const invId = pre.refBy || null;
  return withUsers([userId, invId], (map, c) => fn(map.get(userId) || null, invId ? map.get(invId) || null : null, c));
}

// Starts the miner and records the purchase. Called once the price is paid, inside the buyer's transaction.
async function activate(c, u, inv, plan, via, renewal = false) {
  const contract = makeContract(plan, await takeSerial(c));
  contract.pauseRule = (await guardSettings()).mode; // what a day the profit guard pauses does to this miner's term, fixed at purchase
  const entry = {
    kind: 'purchase',
    label: planLabel(plan),
    date: 'Just now',
    at: Date.now(),
    amount: `-$${plan.id === 'custom' ? plan.price.toFixed(2) : plan.price}`,
    ...(via ? { net: via } : {}),
  };
  u.contracts.push(contract);
  u.history.unshift(entry);
  notify(
    u,
    renewal
      ? { kind: 'purchase', title: 'Smart Mining renewed', body: `${contract.serial} started a new term.` }
      : {
          kind: 'purchase',
          title: plan.smart ? 'Smart Mining is live' : `${plan.name} miner is live`,
          body: plan.smart ? `${contract.serial} started, picking the best coin for you every day` : `${contract.serial} started mining`,
        },
  );
  // Friend gift and the inviter's rewards start once the purchase is live.
  const bonus = await onPurchase(c, u, inv, plan);
  return { contract, entry, ...(bonus ? { bonus } : {}) };
}

async function payBalance(userId, plan, idemKey) {
  const { prices } = await getPrices();
  await getMarket(); // warms the market cache now, so nothing slow happens while the buyer is locked
  const cost = Math.ceil((plan.price / prices.btc) * 1e8) / 1e8;
  return withBuyer(userId, (u, inv, c) =>
    withIdem(c, idemKey, async () => {
      if (!u) return fail(404, 'Account not found.');
      if (cost > (await availableIn(c, u)) + TOLERANCE) return fail(409, 'Not enough balance for this plan.');
      u.spent = (u.spent || 0) + cost;
      await ledger(c, userId, 'spend', { btc: cost, usd: plan.price, ref: planLabel(plan) });
      return { ok: true, status: 200, ...(await activate(c, u, inv, plan, 'Balance')), spentBtc: cost };
    }),
  );
}

const publicOrder = (o) => ({ id: o.id, label: planLabel(o.plan), usd: o.usd, status: o.status, at: o.at, url: o.url || null, address: o.address || null, uri: o.uri || null, amount: o.amount || null, expiresAt: o.expiresAt || null, serial: o.serial || null });

const saveOrder = (c, o) => c.query('UPDATE orders SET status = $2, data = $3::jsonb WHERE id = $1', [o.id, o.status, JSON.stringify(o)]);

// A payment link nobody paid for days is closed. A late payment is still honoured by settleOrder.
const expireOrders = (c, userId) =>
  c.query(
    `UPDATE orders SET status = 'expired', data = jsonb_set(data, '{status}', '"expired"')
     WHERE user_id = $1 AND status = 'pending' AND at < $2`,
    [userId, Date.now() - PENDING_DAYS * 86400000],
  );

async function payCrypto(userId, plan, idemKey) {
  if (!cryptoEnabled()) return fail(503, 'Crypto payments are not switched on yet.');
  const label = `Miner Opus · ${planLabel(plan)}`;

  // 1. Reserve the order under the account lock. The unique idempotency key stops a double tap from making two orders.
  const step = await withUser(userId, async (u, c) => {
    if (!u) return { r: fail(404, 'Account not found.') };
    await expireOrders(c, userId);
    if (idemKey) {
      const ex = (await c.query('SELECT data FROM orders WHERE idem_key = $1', [idemKey])).rows[0]?.data;
      if (ex) {
        if (ex.invoiceId) return { r: { ok: true, status: 200, pending: true, order: publicOrder(ex) } };
        if (Date.now() - ex.at < SETUP_GRACE_MS) return { r: fail(409, 'This payment is still being set up. Try again in a moment.') };
        await c.query('DELETE FROM orders WHERE id = $1', [ex.id]);
      }
    }
    const open = (await c.query("SELECT count(*)::int AS n FROM orders WHERE user_id = $1 AND status = 'pending'", [userId])).rows[0].n;
    if (open >= MAX_PENDING) return { r: fail(409, 'You have unpaid orders. Pay or cancel one first.') };
    const order = { id: `ord_${randomBytes(9).toString('base64url')}`, plan: { ...plan }, usd: cents(plan.price), status: 'pending', at: Date.now() };
    await c.query('INSERT INTO orders (id, user_id, status, at, data, idem_key) VALUES ($1, $2, $3, $4, $5::jsonb, $6)', [order.id, userId, order.status, order.at, JSON.stringify(order), idemKey]);
    return { order };
  });
  if (step.r) return step.r;
  const { order } = step;

  // 2. Ask the provider for the invoice, with no database lock held.
  let inv;
  try {
    inv = await createInvoice(order, label);
  } catch (e) {
    console.error('[pay] invoice failed:', e.message);
    await q('DELETE FROM orders WHERE id = $1', [order.id]);
    return fail(502, 'Could not start the payment. Try again in a moment.');
  }

  // 3. Attach the invoice to the order.
  const fields = { invoiceId: inv.id, url: inv.url || null, address: inv.address || null, uri: inv.uri || null, amount: inv.amount || null, expiresAt: inv.expiresAt || null };
  Object.assign(order, fields);
  // Merge only the invoice fields, so a webhook that settled the order in the meantime keeps its status.
  await q('UPDATE orders SET data = data || $2::jsonb WHERE id = $1', [order.id, JSON.stringify(fields)]);
  return { ok: true, status: 200, pending: true, order: publicOrder(order) };
}

// Admin test tool only: starts a miner for a user without payment (the referral test friend). `input` is a buy request
// such as { planId: 'custom', th: 15, days: 90 }.
export async function grantPlan(userId, input) {
  await refreshPricing();
  const plan = resolvePlan(input);
  if (!plan) return fail(400, 'Invalid size or term.');
  return withBuyer(userId, async (u, inv, c) => (u ? { ok: true, status: 200, ...(await activate(c, u, inv, plan, null)) } : fail(404, 'Account not found.')));
}

// Same Idempotency-Key twice returns the first result instead of buying twice.
export async function buyPlan(input, { userId = 'demo', key } = {}) {
  const idemKey = key ? `buy:${userId}:${key}` : null;
  if (String(input?.pay ?? '') !== 'crypto') {
    const prior = await idemGet(idemKey);
    if (prior) return prior;
  }
  const smartSt = input?.planId === 'smart' ? await smartSettings() : null;
  if (smartSt && !smartSt.enabled) return fail(409, 'Smart Mining is not available right now.');
  await refreshPricing(); // the price is read now and locked on the miner or the order
  const plan = resolvePlan(input, smartSt);
  if (!plan) return fail(400, input?.planId === 'custom' ? 'Invalid size or term.' : input?.planId === 'smart' ? 'Invalid budget or term.' : 'Unknown plan.');
  const how = String(input?.pay ?? '');
  if (how === 'balance') return payBalance(userId, plan, idemKey);
  if (how === 'crypto') return payCrypto(userId, plan, idemKey);
  return fail(400, 'Choose how to pay.');
}

// ---- Renew at term end (Smart Mining) ----
// A Smart Mining miner can carry the switch `renew` (off by default, the user can flip it any time before the term ends). Once the last
// payout day of its term has closed (renewAt), lib/server/renew.js calls renewSmart(): it buys the same budget and term again from the
// balance, at the price and pay table of that moment, through the same steps as a purchase, so the same rules apply (the profit guard
// rule is fixed at purchase, invite rewards follow). There is no service fee. The old miner then carries renewedTo, so it never renews
// twice. When the balance does not cover the price, or Smart Mining is off, nothing is bought, the switch goes off and the user is told.
// The new term keeps the switch on.

// 00:00 UTC after the last payout day of a miner's term (paused days that extend the term included).
export const renewAt = (c, guard, now = Date.now()) => Math.floor((termEnd(c, startOf(c, now), guard) - 1) / 86400000) * 86400000 + 86400000;

export async function setRenew(userId, serial, on) {
  const market = await getMarket(); // read before the lock, so nothing slow happens while the account is held
  return withUser(userId, (u) => {
    if (!u) return fail(404, 'Account not found.');
    const c = u.contracts.find((x) => x.serial === serial);
    if (!c) return fail(404, 'Miner not found.');
    if (!c.smart) return fail(409, 'Only Smart Mining miners can renew.');
    if (on) {
      const now = Date.now();
      if (c.renewedTo || now >= termEnd(c, startOf(c, now), market.guard)) return fail(409, 'This term has ended.');
      c.renew = true;
    } else {
      delete c.renew;
    }
    return { ok: true, status: 200, renew: !!c.renew };
  });
}

// Buys the next term of one miner that is due. Safe to call twice, or on two servers at once: the account row is locked, and a miner
// that has renewed (renewedTo) or has its switch off is left alone.
export async function renewSmart(userId, serial) {
  const smartSt = await smartSettings();
  await refreshPricing();
  const { prices } = await getPrices();
  const market = await getMarket(); // warms the market cache now, so nothing slow happens while the buyer is locked
  return withBuyer(userId, (u, inv, c) =>
    withIdem(c, `renew:${userId}:${serial}`, async () => {
      if (!u) return fail(404, 'Account not found.');
      const old = u.contracts.find((x) => x.serial === serial);
      if (!old || !old.smart || !old.renew || old.renewedTo) return fail(409, 'Nothing to renew.');
      if (Date.now() < renewAt(old, market.guard)) return fail(409, 'This term has not ended yet.');
      const skip = (body) => {
        delete old.renew;
        notify(u, { kind: 'purchase', title: 'Smart Mining not renewed', body });
        return { ok: true, status: 200, renewed: false };
      };
      const plan = smartSt.enabled ? resolveSmart({ budget: old.budget, days: old.days }, smartSt.table) : null;
      if (!plan) return skip('Smart Mining is not available right now.');
      const cost = Math.ceil((plan.price / prices.btc) * 1e8) / 1e8;
      if (cost > (await availableIn(c, u)) + TOLERANCE) return skip('Your balance did not cover the price.');
      u.spent = (u.spent || 0) + cost;
      await ledger(c, userId, 'spend', { btc: cost, usd: plan.price, ref: `${planLabel(plan)} (renewal)` });
      const r = await activate(c, u, inv, plan, 'Balance', true);
      r.contract.renew = true;
      old.renewedTo = r.contract.serial;
      delete old.renew;
      return { ok: true, status: 200, renewed: true, serial: r.contract.serial, spentBtc: cost };
    }),
  );
}

// ---- Orders (crypto payments) ----

// What the buy screen needs: whether crypto is on, and the unpaid or recent orders.
export async function getOrders(userId = 'demo') {
  await expireOrders(pool(), userId);
  const day = Date.now() - 86400000;
  const r = await q(
    `SELECT data FROM orders WHERE user_id = $1
       AND (status IN ('pending', 'review') OR (status = 'paid' AND COALESCE((data->>'paidAt')::bigint, at) > $2))
     ORDER BY at DESC LIMIT 5`,
    [userId, day],
  );
  return { crypto: cryptoEnabled(), demo: userId === 'demo', orders: r.rows.map((x) => publicOrder(x.data)) };
}

export async function cancelOrder(userId, id) {
  const r = await q(
    `UPDATE orders SET status = 'cancelled', data = jsonb_set(data, '{status}', '"cancelled"')
     WHERE id = $1 AND user_id = $2 AND status = 'pending' RETURNING id`,
    [String(id), userId],
  );
  if (r.rowCount) return { ok: true, status: 200 };
  const exists = await q('SELECT 1 FROM orders WHERE id = $1 AND user_id = $2', [String(id), userId]);
  return exists.rowCount ? fail(409, 'This order is no longer open.') : fail(404, 'Order not found.');
}

// Called with a verified provider callback. Starts the miner when the payment finished and matches the order.
// Safe to receive twice, or at the same moment on two servers: the order row is locked, and a paid order is never
// activated again.
export async function settleOrder(p) {
  const id = String(p?.order_id || '');
  const row = (await q('SELECT user_id FROM orders WHERE id = $1', [id])).rows[0];
  if (!row) return fail(404, 'Unknown order.');
  const userId = row.user_id;
  const invId = (await getUser(userId)).refBy || null;

  return withUsers([userId, invId], async (map, c) => {
    const u = map.get(userId);
    const inv = invId ? map.get(invId) || null : null;
    const order = (await c.query('SELECT data FROM orders WHERE id = $1 FOR UPDATE', [id])).rows[0]?.data;
    if (!u || !order) return fail(404, 'Unknown order.');
    const st = String(p.payment_status || '');
    if (st === 'finished') {
      if (order.status === 'paid') return { ok: true, status: 200 };
      const cur = String(p.price_currency || 'usd').toLowerCase();
      if (cur !== 'usd' || !(Number(p.price_amount) >= order.usd - 0.005)) {
        order.status = 'review';
        console.warn(`[pay] order ${id} finished but does not match: ${p.price_amount} ${p.price_currency} vs ${order.usd} usd`);
        notify(u, { kind: 'purchase', title: 'Payment needs a check', body: 'We received a payment that does not match the order, so the miner has not started.' });
        await saveOrder(c, order);
        return { ok: true, status: 200 };
      }
      order.status = 'paid';
      order.paidAt = Date.now();
      if (p.payment_id) order.paymentId = String(p.payment_id);
      const r = await activate(c, u, inv, order.plan, 'Crypto');
      order.serial = r.contract.serial;
      await ledger(c, userId, 'payment', { usd: order.usd, ref: order.id });
    } else if (st === 'partially_paid') {
      if (order.status !== 'paid') {
        order.status = 'review';
        notify(u, { kind: 'purchase', title: 'Payment is short', body: 'The amount received was lower than the price, so the miner has not started.' });
      }
    } else if (st === 'failed' || st === 'expired') {
      if (order.status === 'pending') order.status = st;
    }
    await saveOrder(c, order);
    return { ok: true, status: 200 };
  });
}

// ---- Admin: orders across all users ----

// Newest first. Review orders are the ones that need a person to look.
export async function adminOrders(limit = 60) {
  const r = await q('SELECT user_id, data FROM orders ORDER BY at DESC LIMIT $1', [limit]);
  return r.rows.map((x) => ({ ...publicOrder(x.data), userId: x.user_id, paidAt: x.data.paidAt || null, invoiceId: x.data.invoiceId || null }));
}

// A person looked at a "review" or "pending" order. approve starts the miner (payment confirmed by hand); reject closes it.
export async function reviewOrder(userId, id, decision) {
  const invId = (await getUser(userId)).refBy || null;
  return withUsers([userId, invId], async (map, c) => {
    const u = map.get(userId);
    const inv = invId ? map.get(invId) || null : null;
    const o = (await c.query('SELECT data FROM orders WHERE id = $1 AND user_id = $2 FOR UPDATE', [String(id), userId])).rows[0]?.data;
    if (!u || !o) return fail(404, 'Order not found.');
    if (decision === 'approve') {
      if (o.status === 'paid') return fail(409, 'Already paid.');
      o.status = 'paid';
      o.paidAt = Date.now();
      o.manual = true;
      const r = await activate(c, u, inv, o.plan, 'Crypto');
      o.serial = r.contract.serial;
      await ledger(c, userId, 'payment', { usd: o.usd, ref: `${o.id} (manual)` });
      await saveOrder(c, o);
      return { ok: true, status: 200, serial: o.serial };
    }
    if (decision === 'reject') {
      if (o.status !== 'review' && o.status !== 'pending') return fail(409, 'This order is no longer open.');
      o.status = 'cancelled';
      notify(u, { kind: 'purchase', title: 'Order closed', body: `${planLabel(o.plan)} order was closed by support.` });
      await saveOrder(c, o);
      return { ok: true, status: 200 };
    }
    return fail(400, 'Unknown decision.');
  });
}
