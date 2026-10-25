// Wallet top-ups through the crypto provider against a real Postgres, with the provider replaced by a stub: the order is a
// deposit (not a plan), the minimum is enforced, a double tap makes one order, and a finished payment credits the balance once.
// No request ever leaves the machine for the provider; other URLs (prices) pass through.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const { pool, q, getUser } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');
const miners = await import('@/lib/server/miners');
const { getWallet } = await import('@/lib/server/wallet');
const { getPrices } = await import('@/lib/server/prices');

const run = `d${Date.now().toString(36)}`;
const PW = 'correct horse 1';
const NOW_ENV = { PAY_PROVIDER: '', NOWPAYMENTS_API_KEY: 'np-key-test', NOWPAYMENTS_IPN_SECRET: 'np-ipn-test', NOWPAYMENTS_API_URL: undefined, APP_URL: 'https://app.test' };

const realFetch = globalThis.fetch;
let calls = [];
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let n = 0;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith('https://api.nowpayments.io')) {
    calls.push({ url: u, body: JSON.parse(init?.body || 'null') });
    return json({ id: `inv_${run}_${++n}`, invoice_url: `https://pay.test/i/${run}${n}` });
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
const orderRows = async (id) => (await q('SELECT id, status, data FROM orders WHERE user_id = $1 ORDER BY at, id', [id])).rows;
const hook = (o, extra = {}) => ({ order_id: o.id, payment_status: 'finished', price_amount: o.usd, price_currency: 'usd', payment_id: `pay_${o.id}`, ...extra });
const available = async (id) => {
  const w = await getWallet(id);
  return w.earned - w.withdrawn - w.spent;
};

before(async () => {
  await migrate();
});
beforeEach(() => {
  calls = [];
});
after(async () => {
  globalThis.fetch = realFetch;
  await pool().end();
});

test('a top-up is refused below the minimum and without a provider, and nothing is created', async () => {
  const id = await account('min');
  await withEnv(NOW_ENV, async () => {
    const low = await miners.startDeposit({ usd: 5 }, { userId: id, key: 'k-low' });
    assert.equal(low.ok, false);
    assert.equal(low.status, 422);
    for (const bad of [{ usd: 'abc' }, { usd: -50 }, { usd: 0 }, {}]) {
      assert.equal((await miners.startDeposit(bad, { userId: id, key: 'k-bad' })).status, 422, JSON.stringify(bad));
    }
    assert.equal(calls.length, 0);
    assert.equal((await orderRows(id)).length, 0);
  });
  await withEnv({ NOWPAYMENTS_API_KEY: undefined, NOWPAYMENTS_IPN_SECRET: undefined }, async () => {
    assert.equal((await miners.startDeposit({ usd: 50 }, { userId: id, key: 'k-off' })).status, 503);
  });
});

test('a top-up opens one deposit order with a link back to the wallet, and a repeat with the same key is the same order', async () => {
  const id = await account('open');
  await withEnv(NOW_ENV, async () => {
    const r = await miners.startDeposit({ usd: 50 }, { userId: id, key: 'k-open' });
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.ok(r.ok && r.pending);
    assert.equal(r.order.kind, 'deposit');
    assert.equal(r.order.label, 'Deposit');
    assert.equal(r.order.usd, 50);
    assert.ok(r.order.url.startsWith('https://pay.test/i/'));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.price_amount, 50);
    assert.equal(calls[0].body.order_id, r.order.id);
    assert.equal(calls[0].body.success_url, 'https://app.test/wallet?paid=1');
    assert.equal(calls[0].body.cancel_url, 'https://app.test/wallet');

    const again = await miners.startDeposit({ usd: 50 }, { userId: id, key: 'k-open' });
    assert.equal(again.order.id, r.order.id);
    assert.equal(calls.length, 1);
    assert.equal((await orderRows(id)).length, 1);

    // Top-ups are listed on their own: the plans screen does not see them, the wallet does.
    assert.deepEqual((await miners.getOrders(id)).orders, []);
    assert.deepEqual((await miners.getOrders(id, 'deposit')).orders.map((o) => o.id), [r.order.id]);
    assert.equal((await getUser(id)).contracts.length, 0);
  });
});

test('a finished payment credits the balance once, even when told twice, and starts no miner', async () => {
  const id = await account('paid');
  await withEnv(NOW_ENV, async () => {
    const r = await miners.startDeposit({ usd: 50 }, { userId: id, key: 'k-paid' });
    assert.ok(r.ok);
    assert.equal(await available(id), 0);

    for (let i = 0; i < 2; i += 1) assert.ok((await miners.settleOrder(hook(r.order))).ok);
    const u = await getUser(id);
    assert.ok(u.deposited > 0);
    const { prices } = await getPrices();
    assert.ok(Math.abs(u.deposited * prices.btc - 50) < 1, 'about fifty dollars of BTC');
    assert.ok(Math.abs((await available(id)) - u.deposited) < 1e-9, 'the balance is the credited amount');
    assert.equal(u.contracts.length, 0);
    assert.equal(u.history.filter((h) => h.kind === 'deposit').length, 1);
    assert.equal(u.notifications[0].title, 'Deposit received');
    assert.equal((await orderRows(id))[0].status, 'paid');
    const led = await q("SELECT count(*)::int AS n FROM ledger WHERE user_id = $1 AND kind = 'deposit'", [id]);
    assert.equal(led.rows[0].n, 1);
  });
});

test('a payment that does not match the order is held for review and credits nothing', async () => {
  const id = await account('short');
  await withEnv(NOW_ENV, async () => {
    const a = await miners.startDeposit({ usd: 50 }, { userId: id, key: 'k-short-a' });
    assert.ok((await miners.settleOrder(hook(a.order, { price_amount: 10 }))).ok);
    assert.equal((await orderRows(id))[0].status, 'review');
    assert.equal((await getUser(id)).deposited || 0, 0);

    const b = await miners.startDeposit({ usd: 60 }, { userId: id, key: 'k-short-b' });
    assert.ok((await miners.settleOrder(hook(b.order, { payment_status: 'partially_paid' }))).ok);
    assert.equal((await getUser(id)).deposited || 0, 0);

    // Support can approve the first one by hand: it credits once.
    assert.ok((await miners.reviewOrder(id, a.order.id, 'approve')).ok);
    const after1 = (await getUser(id)).deposited;
    assert.ok(after1 > 0);
    assert.equal((await miners.reviewOrder(id, a.order.id, 'approve')).status, 409);
    assert.equal((await getUser(id)).deposited, after1);
  });
});

test('three unpaid top-ups are the limit, and cancelling one makes room', async () => {
  const id = await account('cancel');
  await withEnv(NOW_ENV, async () => {
    const made = [];
    for (let i = 0; i < 3; i += 1) {
      const r = await miners.startDeposit({ usd: 40 + i }, { userId: id, key: `k-c-${i}` });
      assert.ok(r.ok, JSON.stringify(r));
      made.push(r.order.id);
    }
    assert.equal((await miners.startDeposit({ usd: 99 }, { userId: id, key: 'k-c-3' })).status, 409);
    assert.ok((await miners.cancelOrder(id, made[0])).ok);
    assert.ok((await miners.startDeposit({ usd: 99 }, { userId: id, key: 'k-c-3' })).ok);
  });
});
