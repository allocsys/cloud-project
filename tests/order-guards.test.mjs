// Guards around payment orders against a real Postgres, with the payment provider replaced by a stub:
// #33 opening, cancelling and Solana asks share a limit per account, so a create-and-cancel loop stops;
// #34 an order support rejects has its gateway invoice closed, and a payment that still arrives is held for a person, never paid out;
// low items: a key used again after a cancel or a payment, a paid deposit with no BTC price, and orders expiring only when old.
// No request ever leaves the machine for the provider; other URLs (prices) pass through.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const { pool, q, getUser } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');
const miners = await import('@/lib/server/miners');

const run = `g${Date.now().toString(36)}`;
const PW = 'correct horse 1';
const NOW_ENV = { PAY_PROVIDER: '', NOWPAYMENTS_API_KEY: 'np-key-test', NOWPAYMENTS_IPN_SECRET: 'np-ipn-test', NOWPAYMENTS_API_URL: undefined, APP_URL: 'https://app.test' };
const GW_ENV = { PAY_PROVIDER: 'gateway', GATEWAY_URL: 'https://gateway.test', GATEWAY_API_SECRET: 'gateway-api-secret-0123456789', GATEWAY_WEBHOOK_SECRET: 'gateway-hook-secret-0123456789', APP_URL: 'https://app.test' };

const realFetch = globalThis.fetch;
let calls = [];
let reply = null; // (call) => Response | Promise<Response>; set by each test
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith('https://api.nowpayments.io') || u.startsWith('https://gateway.test')) {
    calls.push({ url: u, body: JSON.parse(init?.body || 'null') });
    if (!reply) throw new Error('provider stub has no reply');
    return reply(calls[calls.length - 1]);
  }
  return realFetch(url, init);
};

// Sets environment variables for fn (undefined removes one), then puts them back.
async function withEnv(vars, fn) {
  const was = {};
  for (const k of Object.keys(vars)) was[k] = process.env[k];
  const apply = (v) => {
    for (const [k, val] of Object.entries(v)) {
      if (val === undefined) delete process.env[k];
      else process.env[k] = val;
    }
  };
  apply(vars);
  try {
    return await fn();
  } finally {
    apply(was);
  }
}

async function account(name) {
  const e = `${name}-${run}@test.dev`;
  assert.ok((await auth.signup({ email: e, password: PW })).ok);
  return e;
}
const SMALL = { planId: 'custom', th: 15, days: 90 };
const pay = (id, key) => miners.buyPlan({ ...SMALL, pay: 'crypto' }, { userId: id, key });
const orderRows = async (id) => (await q('SELECT id, status, data FROM orders WHERE user_id = $1 ORDER BY at, id', [id])).rows;
const hook = (o, extra = {}) => ({ order_id: o.id, payment_status: 'finished', price_amount: o.usd, price_currency: 'usd', payment_id: `pay_${o.id}`, ...extra });
const btc = { pay_currency: 'btc', network: 'btc' };

let n = 0;
const nowInvoice = () => json({ id: `inv_${run}_${++n}`, invoice_url: `https://pay.test/i/${run}${n}` });
const gwReply = (c) =>
  c.url.endsWith('/v1/admin/invoice/close')
    ? json({ ok: true })
    : json({ invoice: { id: `gw_${run}_${++n}`, address: 'bc1qtestaddress0000000000000000000000', uri: 'bitcoin:bc1qtest?amount=0.001', amount: '0.00123456', expires_at: '2026-12-21T00:00:00Z' } }, 201);

before(async () => {
  await migrate();
});
beforeEach(() => {
  calls = [];
  reply = null;
});
after(async () => {
  globalThis.fetch = realFetch;
  await pool().end();
});

test('#33 opening, cancelling and Solana asks share one limit, so a create-and-cancel loop stops', async () => {
  const id = await account('loop');
  await withEnv(NOW_ENV, async () => {
    reply = nowInvoice;
    let opened = 0;
    let stop = null;
    for (let i = 0; i < 40; i += 1) {
      const r = await pay(id, `k-loop-${i}`);
      if (r.status === 429) {
        stop = r;
        break;
      }
      assert.ok(r.ok, JSON.stringify(r));
      opened += 1;
      assert.ok((await miners.cancelOrder(id, r.order.id)).ok);
    }
    assert.ok(stop, 'the loop was stopped');
    assert.equal(opened, 20, 'forty asks in the window, an open and a cancel each');
    assert.equal(calls.length, 20, 'no invoice is asked for once the limit is reached');
    assert.equal((await miners.cancelOrder(id, 'ord_none')).status, 429);
    assert.equal((await miners.solTxFor(id, 'ord_none', 'x')).status, 429);
    assert.equal((await miners.startDeposit({ usd: 50 }, { userId: id, key: 'k-loop-dep' })).status, 429);
    assert.equal(calls.length, 20);

    // Another account is not affected.
    const other = await account('loop-x');
    assert.ok((await pay(other, 'k-loop-other')).ok);
  });
});

test('#34 rejecting a waiting order closes its gateway invoice; a payment that still arrives is held, then support can approve it once', async () => {
  const id = await account('rej');
  await withEnv(GW_ENV, async () => {
    reply = gwReply;
    const r = await pay(id, 'k-rej');
    assert.ok(r.ok, JSON.stringify(r));
    const invoiceId = (await orderRows(id))[0].data.invoiceId;
    assert.ok(invoiceId);
    assert.equal(calls.length, 1);

    assert.ok((await miners.reviewOrder(id, r.order.id, 'reject')).ok);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].url, 'https://gateway.test/v1/admin/invoice/close');
    assert.deepEqual(calls[1].body, { id: invoiceId });
    let row = (await orderRows(id))[0];
    assert.equal(row.status, 'cancelled');
    assert.equal(row.data.rejected, true);

    // The customer pays anyway: no miner, the order goes to review. A repeat of the callback changes nothing.
    for (let i = 0; i < 2; i += 1) assert.ok((await miners.settleOrder(hook(r.order, btc))).ok);
    row = (await orderRows(id))[0];
    assert.equal(row.status, 'review');
    assert.equal((await getUser(id)).contracts.length, 0);
    assert.equal((await getUser(id)).notifications.filter((x) => x.title === 'Payment needs a check').length, 1);

    // A person looks and approves: the miner starts once.
    assert.ok((await miners.reviewOrder(id, r.order.id, 'approve')).ok);
    assert.equal((await miners.reviewOrder(id, r.order.id, 'approve')).status, 409);
    assert.equal((await getUser(id)).contracts.length, 1);
    assert.equal((await orderRows(id))[0].status, 'paid');

    // Rejecting an order that is already in review does not touch the gateway.
    const b = await pay(id, 'k-rej-b');
    assert.ok((await miners.settleOrder(hook(b.order, { ...btc, price_amount: 1 }))).ok);
    assert.equal((await orderRows(id)).find((o) => o.id === b.order.id).status, 'review');
    const before = calls.length;
    assert.ok((await miners.reviewOrder(id, b.order.id, 'reject')).ok);
    assert.equal(calls.length, before);
  });
});

test('#34 a deposit that support rejected is held too, and credits nothing until approved', async () => {
  const id = await account('rejdep');
  await withEnv(GW_ENV, async () => {
    reply = gwReply;
    const r = await miners.startDeposit({ usd: 50 }, { userId: id, key: 'k-rejdep' });
    assert.ok(r.ok, JSON.stringify(r));
    assert.ok((await miners.reviewOrder(id, r.order.id, 'reject')).ok);
    assert.ok((await miners.settleOrder(hook(r.order, btc))).ok);
    assert.equal((await orderRows(id))[0].status, 'review');
    assert.equal((await getUser(id)).deposited || 0, 0);
    assert.ok((await miners.reviewOrder(id, r.order.id, 'approve')).ok);
    assert.ok((await getUser(id)).deposited > 0);
  });
});

test('#34 with NOWPayments there is no gateway invoice to close, and a rejected order is still never paid by a callback', async () => {
  const id = await account('rejnow');
  await withEnv(NOW_ENV, async () => {
    reply = nowInvoice;
    const r = await pay(id, 'k-rejnow');
    assert.ok(r.ok);
    assert.ok((await miners.reviewOrder(id, r.order.id, 'reject')).ok);
    assert.equal(calls.length, 1, 'only the invoice request');
    assert.ok((await miners.settleOrder(hook(r.order))).ok);
    assert.equal((await orderRows(id))[0].status, 'review');
    assert.equal((await getUser(id)).contracts.length, 0);
  });
});

test('low: a key used again after a cancel makes a new order; after a payment it answers with the paid order', async () => {
  const id = await account('rekey');
  await withEnv(NOW_ENV, async () => {
    reply = nowInvoice;
    const a = await pay(id, 'k-re');
    assert.ok(a.ok);
    assert.ok((await miners.cancelOrder(id, a.order.id)).ok);
    const b = await pay(id, 'k-re');
    assert.ok(b.ok && b.pending, JSON.stringify(b));
    assert.notEqual(b.order.id, a.order.id);
    assert.equal(b.order.status, 'pending');
    assert.equal(calls.length, 2);

    assert.ok((await miners.settleOrder(hook(b.order))).ok);
    const c = await pay(id, 'k-re');
    assert.ok(c.ok);
    assert.equal(c.order.id, b.order.id);
    assert.equal(c.order.status, 'paid');
    assert.equal(c.pending, false);
    assert.equal(calls.length, 2, 'no new invoice');
    assert.equal((await orderRows(id)).length, 2);
    assert.equal((await getUser(id)).contracts.length, 1);
  });
});

test('low: a paid deposit is answered fine when no BTC price is available; an unpaid one waits', async () => {
  const id = await account('noprice');
  await withEnv(NOW_ENV, async () => {
    reply = nowInvoice;
    const a = await miners.startDeposit({ usd: 50 }, { userId: id, key: 'k-np-a' });
    const b = await miners.startDeposit({ usd: 60 }, { userId: id, key: 'k-np-b' });
    assert.ok(a.ok && b.ok);
    assert.ok((await miners.settleOrder(hook(a.order))).ok);
    const credited = (await getUser(id)).deposited;
    assert.ok(credited > 0);

    // Take away the BTC price: the feed is live (not static) and no coin has a recent reading.
    const st = globalThis.__vtxPrices;
    const keep = { at: st.at, seen: st.seen, loadP: st.loadP, trendAt: st.trendAt };
    try {
      st.at = Date.now();
      st.seen = {};
      st.loadP = Promise.resolve();
      st.trendAt = Date.now();
      await withEnv({ PRICE_FEED: undefined }, async () => {
        assert.ok((await miners.settleOrder(hook(a.order))).ok, 'already paid: nothing to price');
        assert.equal((await miners.settleOrder(hook(b.order))).status, 503, 'not paid yet: needs the price');
      });
    } finally {
      Object.assign(st, keep);
    }
    assert.equal((await getUser(id)).deposited, credited);
    assert.equal((await orderRows(id)).find((o) => o.id === b.order.id).status, 'pending');
  });
});

test('low: an order nobody paid for days is closed when the list is read, and a recent one is left alone', async () => {
  const id = await account('expire');
  await withEnv(NOW_ENV, async () => {
    reply = nowInvoice;
    const a = await pay(id, 'k-ex-a');
    assert.ok(a.ok);
    assert.deepEqual((await miners.getOrders(id)).orders.map((o) => o.id), [a.order.id]);
    assert.equal((await orderRows(id))[0].status, 'pending');

    await q('UPDATE orders SET at = $2 WHERE id = $1', [a.order.id, Date.now() - 4 * 86400000]);
    assert.deepEqual((await miners.getOrders(id)).orders, []);
    const row = (await orderRows(id))[0];
    assert.equal(row.status, 'expired');
    assert.equal(row.data.status, 'expired');
  });
});
