// The admin switch of the checkout provider against a real Postgres, with both providers replaced by stubs: it refuses a provider that is not
// set up, new orders go to the provider chosen, another server picks the choice up from the database, the choice beats PAY_PROVIDER, and an
// order opened before a switch still settles after it. The choice is removed again in the after hook, so other test files see the environment.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const { pool, q, metaDelete } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');
const miners = await import('@/lib/server/miners');
const provider = await import('@/lib/server/pay-provider');
const { loadProvider, providerSettings } = await import('@/lib/server/pay-setting');
const { act } = await import('@/lib/server/admin');
const { getUser } = await import('@/lib/server/db');

const run = `s${Date.now().toString(36)}`;
const PW = 'correct horse 1';
const BOTH = {
  PAY_PROVIDER: '',
  NOWPAYMENTS_API_KEY: 'np-key-test',
  NOWPAYMENTS_IPN_SECRET: 'np-ipn-test',
  NOWPAYMENTS_API_URL: undefined,
  GATEWAY_URL: 'https://gateway.test',
  GATEWAY_API_SECRET: 'gateway-api-secret-0123456789',
  GATEWAY_WEBHOOK_SECRET: 'gateway-hook-secret-0123456789',
  APP_URL: 'https://app.test',
};
const NONE = { PAY_PROVIDER: '', NOWPAYMENTS_API_KEY: undefined, NOWPAYMENTS_IPN_SECRET: undefined, GATEWAY_URL: undefined, GATEWAY_API_SECRET: undefined, GATEWAY_WEBHOOK_SECRET: undefined };

const realFetch = globalThis.fetch;
let calls = [];
let n = 0;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith('https://api.nowpayments.io')) {
    calls.push(u);
    n += 1;
    return json({ id: `inv_${run}_${n}`, invoice_url: `https://pay.test/i/${run}${n}` });
  }
  if (u.startsWith('https://gateway.test')) {
    calls.push(u);
    const body = JSON.parse(init?.body || '{}');
    return json({ invoice: { id: `gw_${body.ref}`, address: 'bc1qtestaddress0000000000000000000000', uri: 'bitcoin:bc1qtest?amount=0.001', amount: '0.00123456', expires_at: '2026-10-21T00:00:00Z' } }, 201);
  }
  return realFetch(url, init);
};

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
const buy = (id, key) => miners.buyPlan({ ...SMALL, pay: 'crypto' }, { userId: id, key });
const use = (name) => act({ action: 'pay-provider', provider: name });
const saved = async () => (await q("SELECT count(*)::int AS n FROM meta WHERE key = 'payprovider'")).rows[0].n;
const reset = async () => {
  await metaDelete('payprovider');
  provider.setProviderChoice(null);
};

before(async () => {
  await migrate();
});
beforeEach(async () => {
  calls = [];
  await reset();
});
after(async () => {
  await reset();
  globalThis.fetch = realFetch;
  await pool().end();
});

test('a provider that is not set up cannot be chosen, and nothing is saved', async () => {
  await withEnv(NONE, async () => {
    assert.equal((await use('gateway')).status, 409);
    assert.equal((await use('nowpayments')).status, 409);
    assert.equal((await use('doge')).status, 400);
    assert.equal((await act({ action: 'pay-provider' })).status, 400);
    assert.equal(await saved(), 0);
  });
  await withEnv({ ...NONE, NOWPAYMENTS_API_KEY: 'k', NOWPAYMENTS_IPN_SECRET: 's' }, async () => {
    assert.equal((await use('gateway')).status, 409, 'only NOWPayments is set up');
    assert.equal((await use('nowpayments')).ok, true);
  });
});

test('new orders go to the provider chosen, another server reads the choice from the database, and an old order still settles', async () => {
  const id = await account('sw');
  await withEnv(BOTH, async () => {
    assert.equal((await use('gateway')).ok, true);
    const a = await buy(id, 'k-sw-1');
    assert.equal(a.status, 200, JSON.stringify(a));
    assert.ok(calls[0].startsWith('https://gateway.test'));
    assert.equal(a.order.address, 'bc1qtestaddress0000000000000000000000');
    assert.equal((await miners.getOrders(id)).multi, true);

    // A server that has not seen the change (its local choice is empty) reads it from the database.
    provider.setProviderChoice(null);
    assert.equal(provider.provider(), 'nowpayments');
    assert.equal(await loadProvider(), 'gateway');

    assert.equal((await use('nowpayments')).ok, true);
    const b = await buy(id, 'k-sw-2');
    assert.equal(b.status, 200, JSON.stringify(b));
    assert.ok(calls[1].startsWith('https://api.nowpayments.io'));
    assert.ok(b.order.url.startsWith('https://pay.test/i/'));
    assert.equal((await miners.getOrders(id)).multi, false);

    // The gateway order was opened before the switch; its payment still starts the miner.
    const r = await miners.settleOrder({ order_id: a.order.id, payment_status: 'finished', price_amount: a.order.usd, price_currency: 'usd', pay_currency: 'btc', network: 'btc' });
    assert.ok(r.ok);
    assert.equal((await getUser(id)).contracts.length, 1);
  });
});

test('the choice beats PAY_PROVIDER, and removing it gives the environment back', async () => {
  await withEnv({ ...BOTH, PAY_PROVIDER: 'gateway' }, async () => {
    assert.equal(await loadProvider(), 'gateway');
    assert.deepEqual(await providerSettings(), { active: 'gateway', saved: null, ready: { nowpayments: true, gateway: true } });
    assert.equal((await use('nowpayments')).ok, true);
    assert.deepEqual(await providerSettings(), { active: 'nowpayments', saved: 'nowpayments', ready: { nowpayments: true, gateway: true } });
    await reset();
    assert.equal((await providerSettings()).active, 'gateway');
  });
});
