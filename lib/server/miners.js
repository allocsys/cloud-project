// Plan catalogue, the user's miners, buying a plan and paying for it. Storage lives in lib/server/db.js.
// Ways to pay:
//   balance  takes the price from the user's mining and invite balance (BTC at the live rate) and activates at once.
//   crypto   opens a hosted invoice (lib/server/pay-provider.js). The miner starts only when the provider reports the
//            payment finished, through settleOrder() from the signed callback.
//   The demo account is sample data and activates at once without paying.
import { randomBytes } from 'node:crypto';
import { CUSTOM, customPlan } from '@/lib/data';
import { makeContract } from '@/lib/contracts';
import { userOf, store, idem, remember, peekSerial, takeSerial, notify, catalog } from '@/lib/server/db';
import { onPurchase } from '@/lib/server/referrals';
import { getPrices } from '@/lib/server/prices';
import { availableBtc } from '@/lib/server/wallet';
import { cryptoEnabled, createInvoice } from '@/lib/server/pay-provider';

const TOLERANCE = 2e-6; // BTC. Same allowance as withdrawals, for the browser's simulated ticks running slightly ahead.
const MAX_PENDING = 3;
const PENDING_DAYS = 3;

export const getCatalog = () => catalog();

// `nextSerial` is only a preview for the buy sheet; the real serial is assigned at purchase.
export function getMiners(userId = 'demo') {
  return { contracts: userOf(userId).contracts, nextSerial: peekSerial() };
}

export const getMiner = (serial, userId = 'demo') => userOf(userId).contracts.find((c) => c.serial === serial) || null;

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

// Starts the miner and records the purchase. Called once the price is paid.
function activate(userId, plan, via) {
  const u = userOf(userId);
  const contract = makeContract(plan, takeSerial());
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
  const bonus = onPurchase(userId, plan);
  return { contract, entry, ...(bonus ? { bonus } : {}) };
}

async function payBalance(userId, plan) {
  const { prices } = await getPrices();
  const cost = Math.ceil((plan.price / prices.btc) * 1e8) / 1e8;
  // No awaits from here on, so the balance check and the spend cannot interleave with another request.
  if (cost > availableBtc(userId) + TOLERANCE) return fail(409, 'Not enough balance for this plan.');
  const u = userOf(userId);
  u.spent = (u.spent || 0) + cost;
  return { ok: true, status: 200, ...activate(userId, plan, 'Balance'), spentBtc: cost };
}

async function payCrypto(userId, plan) {
  if (!cryptoEnabled()) return fail(503, 'Crypto payments are not switched on yet.');
  const u = userOf(userId);
  u.orders ||= [];
  expire(u);
  if (u.orders.filter((o) => o.status === 'pending').length >= MAX_PENDING) return fail(409, 'You have unpaid orders. Pay or cancel one first.');
  const order = { id: `ord_${randomBytes(9).toString('base64url')}`, plan: { ...plan }, usd: cents(plan.price), status: 'pending', at: Date.now() };
  u.orders.unshift(order);
  try {
    const inv = await createInvoice(order, `Opus Cloud Mining · ${planLabel(plan)}`);
    order.invoiceId = inv.id;
    order.url = inv.url;
  } catch (e) {
    console.error('[pay] invoice failed:', e.message);
    u.orders.splice(u.orders.indexOf(order), 1);
    return fail(502, 'Could not start the payment. Try again in a moment.');
  }
  if (u.orders.length > 20) u.orders.length = 20;
  return { ok: true, status: 200, pending: true, order: publicOrder(order) };
}

// Admin test tool only: starts a plan for a user without payment (the referral test friend).
export function grantPlan(userId, planId) {
  const plan = resolvePlan({ planId });
  return plan ? { ok: true, status: 200, ...activate(userId, plan, null) } : fail(400, 'Unknown plan.');
}

const inflight = new Map(); // same Idempotency-Key while the first request is still running

// Same Idempotency-Key twice returns the first result instead of buying twice.
export function buyPlan(input, { userId = 'demo', key } = {}) {
  const idemKey = key ? `buy:${userId}:${key}` : null;
  if (idemKey && idem.has(idemKey)) return Promise.resolve(idem.get(idemKey));
  if (idemKey && inflight.has(idemKey)) return inflight.get(idemKey);

  const run = async () => {
    const plan = resolvePlan(input);
    if (!plan) return fail(400, input?.planId === 'custom' ? 'Invalid size or term.' : 'Unknown plan.');
    if (userId === 'demo') return { ok: true, status: 200, ...activate(userId, plan, null) };
    const how = String(input?.pay ?? '');
    if (how === 'balance') return payBalance(userId, plan);
    if (how === 'crypto') return payCrypto(userId, plan);
    return fail(400, 'Choose how to pay.');
  };
  const p = run().then((r) => (idemKey && r.ok ? remember(idemKey, r) : r)).finally(() => idemKey && inflight.delete(idemKey));
  if (idemKey) inflight.set(idemKey, p);
  return p;
}

// ---- Orders (crypto payments) ----

const publicOrder = (o) => ({ id: o.id, label: planLabel(o.plan), usd: o.usd, status: o.status, at: o.at, url: o.url || null, serial: o.serial || null });

// A payment link nobody paid for days is closed. A late payment is still honoured by settleOrder.
function expire(u) {
  const old = Date.now() - PENDING_DAYS * 86400000;
  (u.orders || []).forEach((o) => {
    if (o.status === 'pending' && o.at < old) o.status = 'expired';
  });
}

// What the buy screen needs: whether crypto is on, and the unpaid or recent orders.
export function getOrders(userId = 'demo') {
  const u = userOf(userId);
  expire(u);
  const day = Date.now() - 86400000;
  const shown = (u.orders || []).filter((o) => o.status === 'pending' || o.status === 'review' || (o.status === 'paid' && (o.paidAt || o.at) > day));
  return { crypto: cryptoEnabled(), demo: userId === 'demo', orders: shown.slice(0, 5).map(publicOrder) };
}

export function cancelOrder(userId, id) {
  const o = (userOf(userId).orders || []).find((x) => x.id === String(id));
  if (!o) return fail(404, 'Order not found.');
  if (o.status !== 'pending') return fail(409, 'This order is no longer open.');
  o.status = 'cancelled';
  return { ok: true, status: 200 };
}

// Called with a verified provider callback. Starts the miner when the payment finished and matches the order.
// Safe to receive twice: a paid order is never activated again.
export function settleOrder(p) {
  const id = String(p?.order_id || '');
  let u = null;
  let order = null;
  for (const x of store.users.values()) {
    order = (x.orders || []).find((o) => o.id === id);
    if (order) {
      u = x;
      break;
    }
  }
  if (!order) return fail(404, 'Unknown order.');
  const st = String(p.payment_status || '');
  if (st === 'finished') {
    if (order.status === 'paid') return { ok: true, status: 200 };
    const cur = String(p.price_currency || 'usd').toLowerCase();
    if (cur !== 'usd' || !(Number(p.price_amount) >= order.usd - 0.005)) {
      order.status = 'review';
      console.warn(`[pay] order ${id} finished but does not match: ${p.price_amount} ${p.price_currency} vs ${order.usd} usd`);
      notify(u, { kind: 'purchase', title: 'Payment needs a check', body: 'We received a payment that does not match the order, so the miner has not started.' });
      return { ok: true, status: 200 };
    }
    order.status = 'paid';
    order.paidAt = Date.now();
    if (p.payment_id) order.paymentId = String(p.payment_id);
    const r = activate(u.id, order.plan, 'Crypto');
    order.serial = r.contract.serial;
  } else if (st === 'partially_paid') {
    if (order.status !== 'paid') {
      order.status = 'review';
      notify(u, { kind: 'purchase', title: 'Payment is short', body: 'The amount received was lower than the price, so the miner has not started.' });
    }
  } else if (st === 'failed' || st === 'expired') {
    if (order.status === 'pending') order.status = st;
  }
  return { ok: true, status: 200 };
}
