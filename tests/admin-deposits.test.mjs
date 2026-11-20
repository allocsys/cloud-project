// Deposits are their own admin list with their own counts; Orders keep plan purchases only. Against a real Postgres.
// Rows of other tests may be in the table, so only our own rows are checked, and counts as differences.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, q } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');
const miners = await import('@/lib/server/miners');
const { customPlan } = await import('@/lib/data');
const { adminList, overview } = await import('@/lib/server/admin');

const run = `d${Date.now().toString(36)}`;
const mine = (r) => r.id.startsWith(`ord_${run}_`);

before(async () => {
  await migrate();
});

after(async () => {
  await pool().end();
});

test('deposits and plan purchases are listed and counted apart', async () => {
  const email = `deps-${run}@test.dev`;
  assert.ok((await auth.signup({ email, password: 'correct horse 1' })).ok);
  const plan = customPlan(15, 90, miners.getCatalog().halls);
  const at = Date.now();
  const put = (id, status, extra) => q('INSERT INTO orders (id, user_id, status, at, data, idem_key) VALUES ($1, $2, $3, $4, $5::jsonb, NULL)', [id, email, status, at, JSON.stringify({ id, status, at, usd: 50, ...extra })]);

  const dep0 = await adminList('deposits', { filter: 'all' });
  const ord0 = await adminList('orders', { filter: 'all' });
  const cnt0 = (await overview()).counts;

  await put(`ord_${run}_d1`, 'pending', { kind: 'deposit', btc: 0.0005 });
  await put(`ord_${run}_d2`, 'review', { kind: 'deposit', btc: 0.0005 });
  await put(`ord_${run}_d3`, 'paid', { kind: 'deposit', btc: 0.0005 });
  await put(`ord_${run}_p1`, 'pending', { plan: { ...plan }, usd: plan.price });
  await put(`ord_${run}_p2`, 'paid', { plan: { ...plan }, usd: plan.price });

  // The Deposits list holds our 3 deposits and none of our plan orders; Open leaves out the paid one.
  const deps = await adminList('deposits', { filter: 'all', limit: 200 });
  assert.deepEqual(deps.rows.filter(mine).map((r) => r.id).sort(), [`ord_${run}_d1`, `ord_${run}_d2`, `ord_${run}_d3`]);
  assert.ok(deps.rows.filter(mine).every((r) => r.kind === 'deposit' && r.label === 'Deposit'));
  const depsOpen = await adminList('deposits', { filter: 'open', limit: 200 });
  assert.deepEqual(depsOpen.rows.filter(mine).map((r) => r.id).sort(), [`ord_${run}_d1`, `ord_${run}_d2`]);

  // The Orders list holds our 2 plan orders and none of our deposits.
  const ords = await adminList('orders', { filter: 'all', limit: 200 });
  assert.deepEqual(ords.rows.filter(mine).map((r) => r.id).sort(), [`ord_${run}_p1`, `ord_${run}_p2`]);
  assert.ok(ords.rows.filter(mine).every((r) => r.kind === 'plan'));

  // Counts are exact per kind (other tests may add rows at the same time, so at least).
  assert.ok(deps.all >= dep0.all + 3 && deps.open >= dep0.open + 2);
  assert.ok(ords.all >= ord0.all + 2 && ords.open >= ord0.open + 1);
  const cnt = (await overview()).counts;
  assert.ok(cnt.deposits.all >= cnt0.deposits.all + 3 && cnt.deposits.open >= cnt0.deposits.open + 2);
  assert.ok(cnt.orders.all >= cnt0.orders.all + 2 && cnt.orders.open >= cnt0.orders.open + 1);
});
