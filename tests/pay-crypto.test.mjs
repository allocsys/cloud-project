// Starting a crypto payment against a real Postgres, with the payment provider replaced by a stub: the order is reserved,
// the invoice is asked for once, a failed provider leaves nothing behind, a double tap makes one order, and a callback
// afterwards starts the miner. No request ever leaves the machine for the provider; other URLs (prices) pass through.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const { NextRequest } = await import('next/server');
const { pool, q, getUser } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');
const miners = await import('@/lib/server/miners');
const provider = await import('@/lib/server/pay-provider');
const { customPlan } = await import('@/lib/data');
const buyRoute = await import('@/app/api/plans/buy/route');

const run = `c${Date.now().toString(36)}`;
const PW = 'correct horse 1';
const GATEWAY_SECRET = 'gateway-api-secret-0123456789';
const NOW_ENV = { PAY_PROVIDER: '', NOWPAYMENTS_API_KEY: 'np-key-test', NOWPAYMENTS_IPN_SECRET: 'np-ipn-test', NOWPAYMENTS_API_URL: undefined, APP_URL: 'https://app.test' };
const GW_ENV = { PAY_PROVIDER: 'gateway', GATEWAY_URL: 'https://gateway.test', GATEWAY_API_SECRET: GATEWAY_SECRET, GATEWAY_WEBHOOK_SECRET: 'gateway-hook-secret-0123456789', APP_URL: 'https://app.test' };
const OFF_ENV = { PAY_PROVIDER: '', NOWPAYMENTS_API_KEY: undefined, NOWPAYMENTS_IPN_SECRET: undefined, GATEWAY_URL: undefined, GATEWAY_API_SECRET: undefined, GATEWAY_WEBHOOK_SECRET: undefined };

const realFetch = globalThis.fetch;
let calls = [];
let reply = null; // (call) => Response | Promise<Response>; set by each test
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith('https://api.nowpayments.io') || u.startsWith('https://gateway.test')) {
    const call = { url: u, headers: Object.fromEntries(Object.entries(init?.headers || {}).map(([k, v]) => [k.toLowerCase(), v])), body: JSON.parse(init?.body || 'null') };
    calls.push(call);
    if (!reply) throw new Error('provider stub has no reply');
    return reply(call);
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
const SMALL = { planId: 'custom', th: 15, days: 90 }; // 15 TH/s for 90 days, about $26.75
const plan = () => customPlan(15, 90, miners.getCatalog().halls);
const pay = (id, key) => miners.buyPlan({ ...SMALL, pay: 'crypto' }, { userId: id, key });
const orderRows = async (id) => (await q('SELECT id, status, data FROM orders WHERE user_id = $1 ORDER BY at, id', [id])).rows;
const hook = (o, extra = {}) => ({ order_id: o.id, payment_status: 'finished', price_amount: o.usd, price_currency: 'usd', payment_id: `pay_${o.id}`, ...extra });

// A working NOWPayments invoice answer, numbered so each one is different.
let n = 0;
const nowInvoice = () => json({ id: `inv_${run}_${++n}`, invoice_url: `https://pay.test/i/${run}${n}` });

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

test('crypto payments are refused while no provider is switched on, and nothing is created', async () => {
  const id = await account('off');
  await withEnv(OFF_ENV, async () => {
    assert.equal(provider.cryptoEnabled(), false);
    const r = await pay(id, 'k-off');
    assert.equal(r.status, 503);
    assert.equal(calls.length, 0);
    assert.equal((await orderRows(id)).length, 0);
    assert.equal((await miners.getOrders(id)).crypto, false);
  });
});

test('an unknown account is refused before the provider is asked', async () => {
  await withEnv(NOW_ENV, async () => {
    reply = nowInvoice;
    const r = await pay(`ghost-${run}@test.dev`, 'k-ghost');
    assert.equal(r.status, 404);
    assert.equal(calls.length, 0);
  });
});

test('a NOWPayments order asks for one invoice with the right details, then a callback starts the miner', async () => {
  const id = await account('now');
  await withEnv(NOW_ENV, async () => {
    reply = nowInvoice;
    const r = await pay(id, 'k-now');
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.ok(r.ok && r.pending);
    assert.match(r.order.id, /^ord_/);
    assert.equal(r.order.status, 'pending');
    assert.equal(r.order.usd, plan().price);
    assert.ok(r.order.url.startsWith('https://pay.test/i/'));

    assert.equal(calls.length, 1);
    const [c] = calls;
    assert.equal(c.url, 'https://api.nowpayments.io/v1/invoice');
    assert.equal(c.headers['x-api-key'], 'np-key-test');
    assert.equal(c.body.price_amount, plan().price);
    assert.equal(c.body.price_currency, 'usd');
    assert.equal(c.body.order_id, r.order.id);
    assert.equal(c.body.ipn_callback_url, 'https://app.test/api/payments/webhook');
    assert.equal(c.body.success_url, 'https://app.test/plans?paid=1');

    // Saved with the invoice attached, and listed on the buy screen. No miner yet.
    const [row] = await orderRows(id);
    assert.equal(row.status, 'pending');
    assert.ok(row.data.invoiceId.startsWith(`inv_${run}`));
    assert.equal((await getUser(id)).contracts.length, 0);
    const list = await miners.getOrders(id);
    assert.equal(list.crypto, true);
    assert.deepEqual(list.orders.map((o) => o.id), [r.order.id]);

    // The provider reports the payment: the miner starts once, even if told twice.
    for (let i = 0; i < 2; i += 1) assert.ok((await miners.settleOrder(hook(r.order))).ok);
    const u = await getUser(id);
    assert.equal(u.contracts.length, 1);
    assert.equal(u.history.find((h) => h.kind === 'purchase').net, 'Crypto');
    assert.equal((await orderRows(id))[0].status, 'paid');
  });
});

test('the same Idempotency-Key gives the same order and one invoice, even when sent at once', async () => {
  const id = await account('idem');
  await withEnv(NOW_ENV, async () => {
    reply = async () => {
      await new Promise((r) => setTimeout(r, 150)); // slow provider, so the other taps arrive while it is set up
      return nowInvoice();
    };
    const rs = await Promise.all(Array.from({ length: 5 }, () => pay(id, 'k-idem')));
    assert.equal(calls.length, 1, 'the provider is asked once');
    assert.equal((await orderRows(id)).length, 1);
    const ok = rs.filter((r) => r.ok);
    assert.ok(ok.length >= 1);
    assert.ok(rs.filter((r) => !r.ok).every((r) => r.status === 409), 'the rest are told to wait');

    // After it is set up, the same key returns the same order with no new call.
    const again = await pay(id, 'k-idem');
    assert.ok(again.ok && again.pending);
    assert.equal(again.order.id, ok[0].order.id);
    assert.equal(calls.length, 1);
    // A different key is a different order.
    reply = nowInvoice;
    const other = await pay(id, 'k-idem-2');
    assert.ok(other.ok);
    assert.notEqual(other.order.id, ok[0].order.id);
    assert.equal(calls.length, 2);
  });
});

test('a provider that fails leaves no order behind, and the same key can be tried again', async () => {
  const id = await account('fail');
  await withEnv(NOW_ENV, async () => {
    const quiet = console.error;
    console.error = () => {};
    try {
      for (const bad of [() => json({ message: 'down' }, 500), () => json({ id: 'x' }, 200), () => Promise.reject(new Error('network down'))]) {
        reply = bad;
        const r = await pay(id, 'k-fail');
        assert.equal(r.status, 502);
        assert.equal((await orderRows(id)).length, 0, 'the reserved order is removed');
      }
    } finally {
      console.error = quiet;
    }
    reply = nowInvoice;
    const ok = await pay(id, 'k-fail');
    assert.equal(ok.status, 200, JSON.stringify(ok));
    assert.equal((await orderRows(id)).length, 1);
    assert.equal(calls.length, 4);
  });
});

test('three unpaid orders is the limit; cancelling one makes room, and the provider is not asked at the limit', async () => {
  const id = await account('limit');
  await withEnv(NOW_ENV, async () => {
    reply = nowInvoice;
    const made = [];
    for (let i = 0; i < 3; i += 1) {
      const r = await pay(id, `k-lim-${i}`);
      assert.ok(r.ok, JSON.stringify(r));
      made.push(r.order.id);
    }
    assert.equal(calls.length, 3);
    const blocked = await pay(id, 'k-lim-3');
    assert.equal(blocked.status, 409);
    assert.equal(calls.length, 3, 'no invoice for a refused order');
    assert.equal((await orderRows(id)).length, 3);

    assert.ok((await miners.cancelOrder(id, made[0])).ok);
    assert.ok((await pay(id, 'k-lim-3')).ok);
    assert.equal(calls.length, 4);
  });
});

test('through the buy route: a session starts a crypto order for its own account, and a repeat returns it', async () => {
  const id = await account('route');
  const other = await account('route-x');
  await withEnv(NOW_ENV, async () => {
    reply = nowInvoice;
    const post = async (cookieId, body, key) => {
      const res = await buyRoute.POST(
        new NextRequest('http://app.test/api/plans/buy', {
          method: 'POST',
          headers: { cookie: `${auth.COOKIE}=${await auth.newSession(cookieId)}`, 'content-type': 'application/json', 'idempotency-key': key },
          body: JSON.stringify(body),
        }),
      );
      return { status: res.status, body: await res.json() };
    };
    const a = await post(id, { ...SMALL, pay: 'crypto' }, `rk-${run}`);
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.ok(a.body.pending);
    assert.ok(a.body.order.url);
    const b = await post(id, { ...SMALL, pay: 'crypto' }, `rk-${run}`);
    assert.equal(b.body.order.id, a.body.order.id);
    assert.equal(calls.length, 1);
    assert.equal((await orderRows(id)).length, 1);
    assert.equal((await orderRows(other)).length, 0, 'another account has no order');
    // A bad plan is refused before any order or invoice.
    assert.equal((await post(id, { planId: 'nope', pay: 'crypto' }, `rk2-${run}`)).status, 400);
    assert.equal(calls.length, 1);
  });
});

test('gateway mode asks the gateway for a BTC address with its secret and keeps the address, uri and amount', async () => {
  const id = await account('gw');
  await withEnv(GW_ENV, async () => {
    assert.equal(provider.provider(), 'gateway');
    assert.equal(provider.cryptoEnabled(), true);
    reply = (c) =>
      json({ invoice: { id: `gw_${c.body.ref}`, address: 'bc1qtestaddress0000000000000000000000', uri: `bitcoin:bc1qtest?amount=0.001&label=${c.body.ref}`, amount: '0.00123456', expires_at: '2026-10-21T00:00:00Z' } }, 201);
    const r = await pay(id, 'k-gw');
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.equal(r.order.address, 'bc1qtestaddress0000000000000000000000');
    assert.equal(r.order.amount, '0.00123456');
    assert.equal(r.order.expiresAt, '2026-10-21T00:00:00Z');
    assert.equal(r.order.url, null);
    assert.ok(r.order.uri.startsWith('bitcoin:'));

    assert.equal(calls.length, 1);
    const [c] = calls;
    assert.equal(c.url, 'https://gateway.test/v1/invoices');
    assert.equal(c.headers.authorization, `Bearer ${GATEWAY_SECRET}`);
    assert.deepEqual(c.body, { ref: r.order.id, usd: plan().price, network: 'btc', asset: 'btc', kind: 'order' });

    assert.ok((await miners.settleOrder(hook(r.order))).ok);
    assert.equal((await getUser(id)).contracts.length, 1);
  });
});

test('gateway answers that are errors or incomplete fail the payment cleanly', async () => {
  const id = await account('gwbad');
  await withEnv(GW_ENV, async () => {
    const quiet = console.error;
    console.error = () => {};
    try {
      const full = { id: 'g1', address: 'bc1qx', uri: 'bitcoin:bc1qx', amount: '0.1' };
      for (const bad of [() => json({ error: 'no price' }, 503), () => json({ error: 'conflict' }, 409), () => json({ invoice: { ...full, uri: undefined } }, 200), () => json({}, 200)]) {
        reply = bad;
        assert.equal((await pay(id, 'k-gwbad')).status, 502);
        assert.equal((await orderRows(id)).length, 0);
      }
    } finally {
      console.error = quiet;
    }
    assert.equal(calls.length, 4);
  });
});

test('the gateway is switched on only with an https address (or a private one), and long enough secrets', async () => {
  const ok = ['https://gateway.example.com', 'http://gateway.railway.internal:8080', 'http://localhost:3001', 'http://127.0.0.1:3001'];
  const bad = ['http://gateway.example.com', 'ftp://gateway.example.com', 'https://user:pw@gateway.example.com', '', 'not a url', undefined];
  for (const u of ok) assert.equal(provider.gatewayUrlOk(u), true, u);
  for (const u of bad) assert.equal(provider.gatewayUrlOk(u), false, String(u));

  await withEnv(GW_ENV, async () => {
    assert.equal(provider.cryptoEnabled(), true);
    await withEnv({ GATEWAY_URL: 'http://gateway.example.com' }, async () => assert.equal(provider.cryptoEnabled(), false));
    await withEnv({ GATEWAY_API_SECRET: 'short' }, async () => assert.equal(provider.cryptoEnabled(), false));
    await withEnv({ GATEWAY_WEBHOOK_SECRET: 'short' }, async () => assert.equal(provider.cryptoEnabled(), false));
  });
  await withEnv(NOW_ENV, async () => {
    assert.equal(provider.cryptoEnabled(), true);
    await withEnv({ NOWPAYMENTS_IPN_SECRET: undefined }, async () => assert.equal(provider.cryptoEnabled(), false));
  });
});
