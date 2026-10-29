// The demo account is a normal account that starts empty, pays for plans from its balance, and can be wiped back to a
// clean slate from the admin screen (action demo-reset), against a real Postgres. The demo row is shared by the whole
// database, so every test starts by wiping it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, q, getUser, withUser } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');
const miners = await import('@/lib/server/miners');
const { act } = await import('@/lib/server/admin');
const { getWallet } = await import('@/lib/server/wallet');
const { getPrices } = await import('@/lib/server/prices');
const { customPlan } = await import('@/lib/data');

const run = `d${Date.now().toString(36)}`;
let seq = 0;
const clean = async () => {
  const r = await act({ action: 'demo-reset' });
  assert.ok(r.ok, r.error);
  return r;
};
const avail = async () => {
  const w = await getWallet('demo');
  return w.earned - w.withdrawn - w.spent;
};
const buy = () => miners.buyPlan({ planId: 'custom', th: 15, days: 90, pay: 'balance' }, { userId: 'demo', key: `${run}-${++seq}` });
const count = async (sql) => (await q(sql)).rows[0].n;

before(async () => {
  await migrate();
});

after(async () => {
  await clean();
  await pool().end();
});

test('a wiped demo account is empty: no miners, activity, notifications, withdrawals or balance', async () => {
  await getUser('demo'); // creates it when the database is new
  await clean();
  const u = await getUser('demo');
  assert.equal(u.contracts.length, 0);
  assert.equal(u.history.length, 0);
  assert.equal(u.notifications.length, 0);
  assert.equal(u.withdrawn, 0);
  assert.equal(u.refCode, 'VTX-7K2M', 'keeps its invite code');
  assert.equal(await avail(), 0);
});

test('the demo account pays for a plan from its balance and is refused when the balance is gone', async () => {
  await clean();
  const price = customPlan(15, 90, miners.getCatalog().halls).price;
  const rate = (await getPrices()).prices.btc;
  await withUser('demo', (u) => {
    u.withdrawn = -((price / rate) * 1.5); // enough for one starter, not two
  });
  const before = await avail();
  const a = await buy();
  assert.ok(a.ok, a.error);
  assert.ok((await avail()) < before - 0.0001, 'the price left the balance');
  const b = await buy();
  assert.equal(b.ok, false);
  assert.equal(b.status, 409);
  assert.equal((await getUser('demo')).contracts.length, 1, 'only one miner started');
  assert.equal(await count("SELECT count(*)::int AS n FROM ledger WHERE user_id = 'demo' AND kind = 'spend'"), 1);
});

test('the clean-up removes what demo bought, its ledger rows, and the invite test friends, but not real accounts', async () => {
  await clean();
  const real = `real-${run}@test.dev`;
  assert.ok((await auth.signup({ email: real, password: 'correct horse 1' })).ok);
  const f = await act({ action: 'ref-test', code: 'VTX-7K2M', th: 15, days: 90 });
  assert.ok(f.ok, f.error);
  assert.equal(await count(`SELECT count(*)::int AS n FROM users WHERE id = '${f.friend}'`), 1);

  const r = await clean();
  assert.ok(r.friends >= 1);
  assert.equal(await count(`SELECT count(*)::int AS n FROM users WHERE id = '${f.friend}'`), 0, 'the test friend is gone');
  assert.equal(await count("SELECT count(*)::int AS n FROM ledger WHERE user_id = 'demo'"), 0);
  assert.equal(await count("SELECT count(*)::int AS n FROM orders WHERE user_id = 'demo'"), 0);
  assert.equal(await count(`SELECT count(*)::int AS n FROM users WHERE id = '${real}'`), 1, 'a real account is untouched');
  assert.equal(await avail(), 0);
  assert.equal((await getWallet('demo')).spent, 0);
});
