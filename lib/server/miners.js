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
import { pool, q, getUser, withUsers, withUser, withIdem, idemGet, ledger, notify, catalog, takeSerial, peekSerial } from '@/lib/server/db';
import { onPurchase } from '@/lib/server/referrals';
import { getPrices } from '@/lib/server/prices';
import { getMarket } from '@/lib/server/market';
import { withLiveDaily, minerDaily, startOf, stopOf } from '@/lib/earnings';
import { minerCharts } from '@/lib/telemetry';
import { telemetryFor } from '@/lib/server/telemetry';
import { availableIn, TOLERANCE } from '@/lib/server/wallet';
import { cryptoEnabled, createInvoice } from '@/lib/server/pay-provider';

const MAX_PENDING = 3;
const PENDING_DAYS = 3;
const SETUP_GRACE_MS = 120_000; // an order whose invoice was never created after this long is abandoned

export const getCatalog = () => catalog();

// `nextSerial` is only a preview for the buy sheet; the real serial is assigned at purchase.
// dailyUsd on each miner is what it is expected to pay today at the live market (its static value when there is none).
export async function getMiners(userId = 'demo') {
  const [u, nextSerial, market] = await Promise.all([getUser(userId), peekSerial(), getMarket()]);
  return { contracts: withLiveDaily(u.contracts, market), nextSerial };
}

// One miner with its finished payout days (daily, newest first), the BTC they came to (earnedBtc), and its charts:
// charts = { real, hash: { series (24 hourly TH/s), now, hasData }, uptime: { series: [{ label, day, pct }], pct } }.
export async function getMiner(serial, userId = 'demo') {
  const [u, market] = await Promise.all([getUser(userId), getMarket()]);
  const c = u.contracts.find((x) => x.serial === serial);
  if (!c) return null;
  const now = Date.now();
  const d = minerDaily(c, now, market);
  const start = startOf(c, now);
  const tel = await telemetryFor([c], now);
  const charts = minerCharts(c, start, stopOf(c, start, now), tel ? tel.samples[c.serial] || [] : null, now);
  return { ...withLiveDaily([c], market)[0], daily: d.rows, earnedUsd: d.usd, earnedBtc: d.btc, charts };
}

const fail = (status, error) => ({ ok: false, status, error });
const cents = (n) => Math.round(n * 100) / 100;
const planLabel = (p) => (p.id === 'custom' ? `Custom ${p.th} TH/s` : `${p.name} plan`);

function resolvePlan(input) {
  const cat = catalog();
  if (input?.planId === 'custom') {
    const th = Number(input.th);
    const days = Number(input.days);
    if (!Number.isFinite(th) || th < CUSTOM.min || th > CUSTOM.max || !Number.isInteger(th * 2) || !CUSTOM.terms.includes(days)) return null;
    return customPlan(th, days, cat.halls);
  }
  return cat.plans.find((p) => p.id === String(input?.planId ?? '')) || null;
}

// Locks the buyer and their inviter, then runs fn(buyer, inviter, client).
async function withBuyer(userId, fn) {
  const pre = await getUser(userId);
  const invId = pre.refBy || null;
  return withUsers([userId, invId], (map, c) => fn(map.get(userId) || null, invId ? map.get(invId) || null : null, c));
}

// Starts the miner and records the purchase. Called once the price is paid, inside the buyer's transaction.
async function activate(c, u, inv, plan, via) {
  const contract = makeContract(plan, await takeSerial(c));
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
  notify(u, { kind: 'purchase', title: `${plan.name} miner is live`, body: `${contract.serial} started mining` });
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

// Admin test tool only: starts a plan for a user without payment (the referral test friend).
export async function grantPlan(userId, planId) {
  const plan = resolvePlan({ planId });
  if (!plan) return fail(400, 'Unknown plan.');
  return withBuyer(userId, async (u, inv, c) => (u ? { ok: true, status: 200, ...(await activate(c, u, inv, plan, null)) } : fail(404, 'Account not found.')));
}

// Same Idempotency-Key twice returns the first result instead of buying twice.
export async function buyPlan(input, { userId = 'demo', key } = {}) {
  const idemKey = key ? `buy:${userId}:${key}` : null;
  if (String(input?.pay ?? '') !== 'crypto') {
    const prior = await idemGet(idemKey);
    if (prior) return prior;
  }
  const plan = resolvePlan(input);
  if (!plan) return fail(400, input?.planId === 'custom' ? 'Invalid size or term.' : 'Unknown plan.');
  const how = String(input?.pay ?? '');
  if (how === 'balance') return payBalance(userId, plan, idemKey);
  if (how === 'crypto') return payCrypto(userId, plan, idemKey);
  return fail(400, 'Choose how to pay.');
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
