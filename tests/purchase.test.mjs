// Buying and paying against a real Postgres, from the HTTP routes down: a signed-in session buys for its own account
// (never the demo one), the balance is charged exactly once, and payment callbacks and manual reviews start a miner once.
// Each test uses its own accounts, so reruns on the same database are fine.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { NextRequest } = await import('next/server');
const { pool, q, getUser, withUser } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');
const miners = await import('@/lib/server/miners');
const { TOLERANCE } = await import('@/lib/server/wallet');
const { getPrices } = await import('@/lib/server/prices');
const { CUSTOM, customPlan } = await import('@/lib/data');
const buyRoute = await import('@/app/api/plans/buy/route');
const minersRoute = await import('@/app/api/miners/route');

const run = `p${Date.now().toString(36)}`;
const email = (n) => `${n}-${run}@test.dev`;
const PW = 'correct horse 1';
const many = (n, fn) => Promise.all(Array.from({ length: n }, (_, i) => fn(i)));

async function account(name) {
  const e = email(name);
  assert.ok((await auth.signup({ email: e, password: PW })).ok);
  return e;
}
// Test money: a negative "withdrawn" adds to the available balance.
const credit = (id, btc) =>
  withUser(id, (u) => {
    u.withdrawn = (u.withdrawn || 0) - btc;
  });
// The small miner most tests buy: 15 TH/s for 90 days (about $26.75 at the default hall rates).
const starter = () => customPlan(15, 90, miners.getCatalog().halls);
const BUY = { planId: 'custom', th: 15, days: 90, pay: 'balance' };
const costOf = async (plan) => Math.ceil((plan.price / (await getPrices()).prices.btc) * 1e8) / 1e8;
const ledgerRows = async (id, kind) => (await q('SELECT btc, usd, ref FROM ledger WHERE user_id = $1 AND kind = $2 ORDER BY id', [id, kind])).rows;
const spentOf = async (id) => (await getUser(id)).spent || 0;

// A request as the app sends it: the session cookie, a JSON body and an optional Idempotency-Key.
const cookieOf = async (id) => `${auth.COOKIE}=${await auth.newSession(id)}`;
const tamper = (cookie) => cookie.slice(0, -1) + (cookie.endsWith('A') ? 'B' : 'A');
async function call(handler, url, { cookie, method = 'GET', body, key } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (key) headers['idempotency-key'] = key;
  const res = await handler(new NextRequest(`http://app.test${url}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined }));
  return { status: res.status, body: await res.json() };
}
const buy = (cookie, body, key) => call(buyRoute.POST, '/api/plans/buy', { cookie, method: 'POST', body, key });
const listMiners = (cookie) => call(minersRoute.GET, '/api/miners', { cookie });

// Runs fn with REQUIRE_AUTH set (or removed), then puts it back.
async function withAuthMode(value, fn) {
  const was = process.env.REQUIRE_AUTH;
  if (value === undefined) delete process.env.REQUIRE_AUTH;
  else process.env.REQUIRE_AUTH = value;
  try {
    return await fn();
  } finally {
    if (was === undefined) delete process.env.REQUIRE_AUTH;
    else process.env.REQUIRE_AUTH = was;
  }
}

// A crypto order as the buy route would have saved it, so the callback paths can be tested without a provider.
let seq = 0;
async function order(userId, plan, { at = Date.now() } = {}) {
  const o = { id: `ord_${run}_${++seq}`, plan: { ...plan }, usd: plan.price, status: 'pending', at };
  await q('INSERT INTO orders (id, user_id, status, at, data, idem_key) VALUES ($1, $2, $3, $4, $5::jsonb, NULL)', [o.id, userId, 'pending', at, JSON.stringify(o)]);
  return o;
}
const statusOf = async (id) => (await q('SELECT status FROM orders WHERE id = $1', [id])).rows[0]?.status;
const hook = (o, extra = {}) => ({ order_id: o.id, payment_status: 'finished', price_amount: o.usd, price_currency: 'usd', payment_id: `pay_${o.id}`, ...extra });

before(async () => {
  await migrate();
});

after(async () => {
  await pool().end();
});

test('a session is its own account; a missing or forged one is demo, or signed out when sign-in is required', async () => {
  const id = await account('sess');
  const good = await auth.newSession(id);
  const bad = tamper(good);
  const req = (t) => ({ cookies: { get: (name) => (name === auth.COOKIE && t ? { value: t } : undefined) } });

  await withAuthMode(undefined, async () => {
    assert.equal(await auth.userId(req(good)), id);
    assert.equal(await auth.userId(req(null)), 'demo');
    assert.equal(await auth.userId(req(bad)), 'demo');
  });
  await withAuthMode('1', async () => {
    assert.equal(await auth.userId(req(good)), id);
    assert.equal(await auth.userId(req(null)), null);
    assert.equal(await auth.userId(req(bad)), null);
  });
});

test('a signed-in buy lands on that account, is charged once, and shows in /api/miners', async () => {
  const a = await account('rt-a');
  const b = await account('rt-b');
  const plan = starter();
  const cost = await costOf(plan);
  await credit(a, cost * 2.5);
  const ca = await cookieOf(a);
  const cb = await cookieOf(b);

  const r = await buy(ca, BUY, `k-${run}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.ok);
  assert.ok(r.body.contract.serial);
  assert.ok(Math.abs(r.body.spentBtc - cost) < 1e-9);

  // The same key again is the same miner, not a second purchase.
  const again = await buy(ca, BUY, `k-${run}`);
  assert.equal(again.status, 200);
  assert.equal(again.body.contract.serial, r.body.contract.serial);

  const u = await getUser(a);
  assert.equal(u.contracts.length, 1);
  assert.ok(Math.abs(u.spent - cost) < 1e-9, `spent ${u.spent}`);
  assert.equal(u.history.filter((h) => h.kind === 'purchase').length, 1);
  assert.equal((await ledgerRows(a, 'spend')).length, 1);

  const mine = await listMiners(ca);
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.body.contracts.map((c) => c.serial), [r.body.contract.serial]);
  assert.ok(mine.body.nextSerial);
  assert.equal((await listMiners(cb)).body.contracts.length, 0, 'another account does not see it');
  assert.equal((await getUser(b)).contracts.length, 0);
});

test('with sign-in required, no session or a forged one cannot buy or list miners', async () => {
  const id = await account('req');
  await credit(id, 5);
  await withAuthMode('1', async () => {
    const good = await cookieOf(id);
    for (const c of [undefined, tamper(good)]) {
      assert.equal((await buy(c, BUY)).status, 401);
      assert.equal((await listMiners(c)).status, 401);
    }
    assert.equal((await getUser(id)).contracts.length, 0);
    assert.equal(await spentOf(id), 0);
    assert.equal((await buy(good, BUY)).status, 200);
    assert.equal((await getUser(id)).contracts.length, 1);
  });
});

test('a real account cannot buy without paying, and bad plans, sizes or bodies are refused', async () => {
  const id = await account('rules');
  await credit(id, 5); // plenty, so only the rules can stop these
  const c = await cookieOf(id);
  const bad = [
    { planId: 'custom', th: 15, days: 90 }, // no way to pay: never the free demo path
    { planId: 'custom', th: 15, days: 90, pay: 'free' },
    { planId: 'starter', pay: 'balance' }, // the old fixed plans are gone
    { planId: 'nope', pay: 'balance' },
    { pay: 'balance' },
    { planId: 'custom', th: CUSTOM.min - 0.5, days: 90, pay: 'balance' },
    { planId: 'custom', th: CUSTOM.max + 1, days: 90, pay: 'balance' },
    { planId: 'custom', th: 2.25, days: 90, pay: 'balance' }, // not a 0.5 step
    { planId: 'custom', th: 5, days: 30, pay: 'balance' }, // not an offered term
    { planId: 'custom', th: 'abc', days: 90, pay: 'balance' },
  ];
  for (const body of bad) assert.equal((await buy(c, body)).status, 400, JSON.stringify(body));

  const raw = await buyRoute.POST(new NextRequest('http://app.test/api/plans/buy', { method: 'POST', headers: { cookie: c, 'content-type': 'application/json' }, body: '{nope' }));
  assert.equal(raw.status, 400);

  assert.equal((await getUser(id)).contracts.length, 0);
  assert.equal(await spentOf(id), 0);
  assert.equal((await ledgerRows(id, 'spend')).length, 0);
});

test('the balance covers the price within the tolerance and no further', async () => {
  const plan = starter();
  const cost = await costOf(plan);
  const pay = (id) => miners.buyPlan(BUY, { userId: id, key: `k-${id}` });

  const short = await account('short');
  await credit(short, cost - TOLERANCE * 2.5);
  assert.equal((await pay(short)).status, 409);
  assert.equal((await getUser(short)).contracts.length, 0);
  assert.equal(await spentOf(short), 0);
  assert.equal((await ledgerRows(short, 'spend')).length, 0);

  const exact = await account('exact');
  await credit(exact, cost);
  assert.ok((await pay(exact)).ok);

  const edge = await account('edge');
  await credit(edge, cost - TOLERANCE / 2);
  assert.ok((await pay(edge)).ok);
});

test('a custom miner is priced from the catalogue halls and charged to the cent', async () => {
  const th = 12.5;
  const days = 180;
  const plan = customPlan(th, days, miners.getCatalog().halls);
  const cost = await costOf(plan);
  const id = await account('custom');
  await credit(id, cost * 1.2);

  const r = await miners.buyPlan({ planId: 'custom', th, days, pay: 'balance' }, { userId: id, key: 'c1' });
  assert.ok(r.ok, JSON.stringify(r));
  const u = await getUser(id);
  assert.equal(u.contracts.length, 1);
  const entry = u.history.find((h) => h.kind === 'purchase');
  assert.equal(entry.amount, `-$${plan.price.toFixed(2)}`);
  assert.equal(entry.net, 'Balance');
  const [row] = await ledgerRows(id, 'spend');
  assert.equal(Number(row.usd), plan.price);
  assert.ok(Math.abs(Number(row.btc) - cost) < 1e-8);
});

test('a payment that does not match the order starts nothing and waits for a person', async () => {
  const plan = starter();
  const cases = [
    ['under', { price_amount: plan.price - 0.01 }, 'Payment needs a check'],
    ['currency', { price_currency: 'btc' }, 'Payment needs a check'],
    ['partial', { payment_status: 'partially_paid' }, 'Payment is short'],
  ];
  for (const [name, extra, title] of cases) {
    const id = await account(`mm-${name}`);
    const o = await order(id, plan);
    assert.ok((await miners.settleOrder(hook(o, extra))).ok, name);
    assert.equal(await statusOf(o.id), 'review', name);
    const u = await getUser(id);
    assert.equal(u.contracts.length, 0, name);
    assert.equal(u.notifications[0].title, title, name);
    assert.equal((await ledgerRows(id, 'payment')).length, 0, name);
  }
});

test('a payment a few cents under the price is accepted, and so is an overpayment', async () => {
  const plan = starter();
  for (const [name, amount] of [['cents', plan.price - 0.004], ['over', plan.price + 5]]) {
    const id = await account(`ok-${name}`);
    const o = await order(id, plan);
    assert.ok((await miners.settleOrder(hook(o, { price_amount: amount }))).ok);
    assert.equal(await statusOf(o.id), 'paid', name);
    assert.equal((await getUser(id)).contracts.length, 1, name);
    assert.equal((await ledgerRows(id, 'payment')).length, 1, name);
  }
});

test('a person can approve a held order once, or reject it, and only for its owner', async () => {
  const plan = starter();
  const id = await account('rv');
  const stranger = await account('rv-x');
  const o = await order(id, plan);
  assert.ok((await miners.settleOrder(hook(o, { payment_status: 'partially_paid' }))).ok);
  assert.equal(await statusOf(o.id), 'review');

  assert.equal((await miners.reviewOrder(stranger, o.id, 'approve')).status, 404);
  assert.equal((await getUser(stranger)).contracts.length, 0);

  const rs = await many(4, () => miners.reviewOrder(id, o.id, 'approve'));
  assert.equal(rs.filter((r) => r.ok).length, 1);
  assert.deepEqual([...new Set(rs.filter((r) => !r.ok).map((r) => r.status))], [409]);
  assert.equal((await getUser(id)).contracts.length, 1);
  assert.equal(await statusOf(o.id), 'paid');
  const rows = await ledgerRows(id, 'payment');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ref, `${o.id} (manual)`);

  assert.equal((await miners.reviewOrder(id, o.id, 'reject')).status, 409, 'a paid order cannot be rejected');
  assert.equal((await miners.reviewOrder(id, o.id, 'maybe')).status, 400);
  assert.equal((await miners.reviewOrder(id, 'ord_nope', 'approve')).status, 404);

  const held = await order(id, plan);
  assert.ok((await miners.settleOrder(hook(held, { price_amount: 1 }))).ok);
  assert.ok((await miners.reviewOrder(id, held.id, 'reject')).ok);
  assert.equal(await statusOf(held.id), 'cancelled');
  assert.equal((await getUser(id)).contracts.length, 1, 'a rejected order starts nothing');
  assert.equal((await miners.reviewOrder(id, held.id, 'reject')).status, 409);
});

test('unfinished, expired and failed callbacks; a late payment is still honoured once', async () => {
  const plan = starter();
  const id = await account('late');

  const o = await order(id, plan);
  for (const s of ['waiting', 'confirming', 'sending']) assert.ok((await miners.settleOrder(hook(o, { payment_status: s }))).ok);
  assert.equal(await statusOf(o.id), 'pending', 'progress messages change nothing');
  assert.ok((await miners.settleOrder(hook(o, { payment_status: 'expired' }))).ok);
  assert.equal(await statusOf(o.id), 'expired');
  assert.equal((await getUser(id)).contracts.length, 0);

  const rs = await many(3, () => miners.settleOrder(hook(o)));
  assert.ok(rs.every((r) => r.ok));
  assert.equal(await statusOf(o.id), 'paid');
  assert.equal((await getUser(id)).contracts.length, 1);

  assert.ok((await miners.settleOrder(hook(o, { payment_status: 'failed' }))).ok);
  assert.equal(await statusOf(o.id), 'paid', 'a paid order stays paid');
  assert.equal((await getUser(id)).contracts.length, 1);

  const f = await order(id, plan);
  assert.ok((await miners.settleOrder(hook(f, { payment_status: 'failed' }))).ok);
  assert.equal(await statusOf(f.id), 'failed');

  assert.equal((await miners.settleOrder({ order_id: 'ord_nope', payment_status: 'finished' })).status, 404);
  assert.equal((await miners.settleOrder({})).status, 404);
});

test('an unpaid link older than three days is closed, and cancelling is for the owner only', async () => {
  const plan = starter();
  const id = await account('exp');
  const stranger = await account('exp-x');
  const old = await order(id, plan, { at: Date.now() - 4 * 86400000 });
  const fresh = await order(id, plan);

  const list = await miners.getOrders(id);
  assert.deepEqual(list.orders.map((o) => o.id), [fresh.id]);
  assert.equal(await statusOf(old.id), 'expired');

  assert.equal((await miners.cancelOrder(stranger, fresh.id)).status, 404);
  assert.equal(await statusOf(fresh.id), 'pending');
  assert.ok((await miners.cancelOrder(id, fresh.id)).ok);
  assert.equal((await miners.cancelOrder(id, fresh.id)).status, 409);
  assert.equal((await miners.cancelOrder(id, 'ord_nope')).status, 404);

  assert.ok((await miners.settleOrder(hook(old))).ok, 'a late payment on the closed link');
  assert.equal(await statusOf(old.id), 'paid');
  assert.equal((await getUser(id)).contracts.length, 1);
});
