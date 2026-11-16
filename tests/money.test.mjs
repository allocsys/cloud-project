// Money paths against a real Postgres. Each test uses its own accounts, so reruns on the same database are fine.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, q, getUser, withUser, pruneIdem } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');
const miners = await import('@/lib/server/miners');
const { withdraw, availableIn } = await import('@/lib/server/wallet');
const { getPrices } = await import('@/lib/server/prices');
const { customPlan } = await import('@/lib/data');
const { publicCode, FREE_INVITES, applyLink } = await import('@/lib/server/referrals');

const run = `m${Date.now().toString(36)}`;
const email = (n) => `${n}-${run}@test.dev`;
const PW = 'correct horse 1';
const ADDR = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
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
const ledgerSum = async (id, kind) => Number((await q('SELECT COALESCE(sum(btc), 0) AS s FROM ledger WHERE user_id = $1 AND kind = $2', [id, kind])).rows[0].s);
const SMALL = { planId: 'custom', th: 15, days: 90 }; // the small miner these tests buy
const starter = () => customPlan(15, 90, miners.getCatalog().halls);
const costOf = async (plan) => Math.ceil((plan.price / (await getPrices()).prices.btc) * 1e8) / 1e8;

before(async () => {
  await migrate();
});

after(async () => {
  await pool().end();
});

test('a balance read inside the lock never waits on the live market', async () => {
  // This test runs first, while the market feeds have never been read: with every feed unreachable, a locked
  // read that went back to the live market would wait out the feed timeouts; it must use cached values only.
  const id = await account('nolive');
  const realFetch = globalThis.fetch;
  const wasFeed = process.env.PRICE_FEED;
  globalThis.fetch = () => new Promise((_, reject) => setTimeout(() => reject(new Error('feed down')), 3000));
  delete process.env.PRICE_FEED;
  try {
    const t0 = Date.now();
    const bal = await withUser(id, (u, c) => availableIn(c, u));
    assert.ok(Date.now() - t0 < 2000, `locked read took ${Date.now() - t0}ms`);
    assert.equal(typeof bal, 'number');
  } finally {
    globalThis.fetch = realFetch;
    if (wasFeed === undefined) delete process.env.PRICE_FEED;
    else process.env.PRICE_FEED = wasFeed;
  }
});

test('concurrent buys never spend more than the balance', async () => {
  const id = await account('buy');
  const cost = await costOf(starter());
  await credit(id, cost * 3.5);
  const rs = await many(10, (i) => miners.buyPlan({ ...SMALL, pay: 'balance' }, { userId: id, key: `k${i}` }));
  assert.equal(rs.filter((r) => r.ok).length, 3);
  assert.deepEqual([...new Set(rs.filter((r) => !r.ok).map((r) => r.status))], [409]);
  const u = await getUser(id);
  assert.equal(u.contracts.length, 3);
  assert.ok(Math.abs(u.spent - cost * 3) < 1e-9, `spent ${u.spent}`);
  assert.ok(Math.abs((await ledgerSum(id, 'spend')) - u.spent) < 1e-8, 'ledger spend matches the account');
  assert.equal((await q("SELECT count(*)::int AS n FROM ledger WHERE user_id = $1 AND kind = 'spend'", [id])).rows[0].n, 3);
});

test('the same buy key twice buys once', async () => {
  const id = await account('buykey');
  const cost = await costOf(starter());
  await credit(id, cost * 10);
  const rs = await many(5, () => miners.buyPlan({ ...SMALL, pay: 'balance' }, { userId: id, key: 'same' }));
  assert.ok(rs.every((r) => r.ok));
  assert.equal(new Set(rs.map((r) => r.contract?.serial)).size, 1);
  assert.equal((await getUser(id)).contracts.length, 1);
});

test('concurrent withdrawals never overdraw', async () => {
  const id = await account('wd');
  await credit(id, 0.0035);
  const rs = await many(8, (i) => withdraw({ asset: 'btc', net: 'btc', amount: 0.001, address: ADDR }, { userId: id, key: `w${i}` }));
  assert.equal(rs.filter((r) => r.ok).length, 3);
  assert.deepEqual([...new Set(rs.filter((r) => !r.ok).map((r) => r.status))], [409]);
  assert.ok(Math.abs((await getUser(id)).withdrawn - -0.0005) < 1e-9);
  assert.ok(Math.abs((await ledgerSum(id, 'withdrawal')) - 0.003) < 1e-8, 'ledger withdrawals match the account');
});

test('a payment callback received many times starts one miner', async () => {
  const id = await account('settle');
  const plan = starter();
  const order = { id: `ord_${run}`, plan: { ...plan }, usd: plan.price, status: 'pending', at: Date.now() };
  await q('INSERT INTO orders (id, user_id, status, at, data, idem_key) VALUES ($1, $2, $3, $4, $5::jsonb, NULL)', [order.id, id, 'pending', order.at, JSON.stringify(order)]);
  const hook = { order_id: order.id, payment_status: 'finished', price_amount: plan.price, price_currency: 'usd', payment_id: 'p1' };
  const rs = await many(6, () => miners.settleOrder(hook));
  assert.ok(rs.every((r) => r.ok));
  assert.equal((await getUser(id)).contracts.length, 1);
  assert.equal((await q('SELECT status FROM orders WHERE id = $1', [order.id])).rows[0].status, 'paid');
});

test('serial numbers stay unique across accounts buying at once', async () => {
  const ids = await Promise.all(Array.from({ length: 12 }, (_, i) => account(`ser${i}`)));
  const rs = await Promise.all(ids.map((id) => miners.grantPlan(id, SMALL)));
  assert.ok(rs.every((r) => r.ok));
  const serials = (await Promise.all(ids.map((id) => getUser(id)))).flatMap((u) => u.contracts.map((c) => c.serial));
  assert.equal(serials.length, 12);
  assert.equal(new Set(serials).size, 12);
});

test('two friends buying at once are both counted and get unique miners', async () => {
  const inviter = await account('inv');
  assert.ok((await miners.grantPlan(inviter, SMALL)).ok);
  const code = (await getUser(inviter)).refCode;
  assert.ok(code);
  const friends = [email('fr1'), email('fr2')];
  for (const f of friends) assert.equal((await auth.signup({ email: f, password: PW, ref: code })).ref, 'applied');
  const rs = await Promise.all(friends.map((f) => miners.grantPlan(f, SMALL)));
  assert.ok(rs.every((r) => r.ok));
  const us = await Promise.all(friends.map((f) => getUser(f)));
  for (const u of us) {
    assert.equal(u.refBy, inviter);
    assert.ok(u.refBonusAt && u.refRewardAt);
  }
  const serials = us.flatMap((u) => u.contracts.map((c) => c.serial));
  assert.equal(new Set(serials).size, serials.length);
});

test('an account with no plan can bring in 3 friends; buying a plan lifts the limit', async () => {
  const inviter = await account('lim');
  const code = (await getUser(inviter)).refCode;
  const sign = (n) => auth.signup({ email: email(n), password: PW, ref: code });
  // Five sign-ups at once: exactly FREE_INVITES are linked, the rest still get an account but no link.
  const rs = await many(5, (i) => sign(`lf${i}`));
  assert.ok(rs.every((r) => r.ok));
  assert.equal(rs.filter((r) => r.ref === 'applied').length, FREE_INVITES);
  assert.equal(rs.filter((r) => r.ref === 'invalid').length, 2);
  assert.equal((await publicCode(code)).valid, false);
  for (let i = 0; i < 3; i += 1) assert.ok((await miners.grantPlan(inviter, SMALL)).ok);
  assert.equal((await publicCode(code)).valid, true);
  assert.equal((await sign('lf5')).ref, 'applied');
});

test('a buy key replayed after the cleanup still buys once', async () => {
  const id = await account('buyprune');
  const cost = await costOf(starter());
  await credit(id, cost * 10);
  const first = await miners.buyPlan({ ...SMALL, pay: 'balance' }, { userId: id, key: 'same' });
  assert.ok(first.ok, first.error);
  await q("UPDATE idem SET at = now() - interval '4 days' WHERE key = $1", [`buy:${id}:same`]);
  await pruneIdem(); // the periodic cleanup: money keys are kept, so the replay still finds the first result
  const again = await miners.buyPlan({ ...SMALL, pay: 'balance' }, { userId: id, key: 'same' });
  assert.ok(again.ok, again.error);
  assert.equal(again.contract.serial, first.contract.serial);
  assert.equal((await getUser(id)).contracts.length, 1);
  assert.equal((await q("SELECT count(*)::int AS n FROM ledger WHERE user_id = $1 AND kind = 'spend'", [id])).rows[0].n, 1);
});

test('a link made while a purchase waits on the lock still gives the gift', async () => {
  const inviter = await account('lk-inv');
  assert.ok((await miners.grantPlan(inviter, SMALL)).ok);
  const code = (await getUser(inviter)).refCode;
  assert.ok(code);
  const friend = email('lk-fr');
  assert.ok((await auth.signup({ email: friend, password: PW })).ok); // no code yet
  // Hold the friend's row locked, link them inside that lock, and start the purchase while it waits: the purchase
  // reads the inviter from the locked document, so it must see the link even though it was not there when it started.
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  let linked;
  const linkedP = new Promise((r) => {
    linked = r;
  });
  const holder = withUser(friend, async (u, c) => {
    assert.ok((await applyLink(c, u, code)).ok);
    linked();
    await gate; // hold the lock until the purchase is waiting on it
    return true;
  });
  await linkedP; // the link is applied and the row is locked, but not yet committed
  const buying = miners.grantPlan(friend, SMALL);
  await new Promise((r) => setTimeout(r, 500)); // let the purchase reach the lock and block
  release();
  const [bought] = await Promise.all([buying, holder]);
  assert.ok(bought.ok, bought.error);
  const f = await getUser(friend);
  assert.equal(f.refBy, inviter);
  assert.equal(f.contracts.length, 2, 'bought miner plus the welcome gift');
  assert.ok(f.refBonusAt && f.refRewardAt, 'the reward started');
});
