// The 24-hour refund the Terms promise, against a real Postgres: a paid miner inside the window is removed and its price
// goes back to the balance as a logged entry; granted miners, gifts, late requests and repeats are refused.
// Each test uses its own accounts, so reruns on the same database are fine.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, q, getUser, withUser } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');
const miners = await import('@/lib/server/miners');
const { act, refundMiner } = await import('@/lib/server/admin');
const { getWallet } = await import('@/lib/server/wallet');

const run = `r${Date.now().toString(36)}`;
const PW = 'correct horse 1';
const HOUR = 3600 * 1000;

async function account(name) {
  const e = `${name}-${run}@test.dev`;
  assert.ok((await auth.signup({ email: e, password: PW })).ok);
  return e;
}
// Test money: a negative "withdrawn" adds to the available balance.
const credit = (id, btc) =>
  withUser(id, (u) => {
    u.withdrawn = (u.withdrawn || 0) - btc;
  });
const availOf = async (id) => {
  const w = await getWallet(id);
  return w.earned - w.withdrawn - w.spent;
};
const starter = () => miners.getCatalog().plans.find((p) => p.id === 'starter');
let seq = 0;
async function buy(id) {
  const r = await miners.buyPlan({ planId: 'starter', pay: 'balance' }, { userId: id, key: `${run}-${++seq}` });
  assert.ok(r.ok, r.error);
  return r.contract.serial;
}
const refund = (userId, serial) => act({ action: 'miner', userId, serial, op: 'refund' });
const gift = (n) => ({ serial: `OP-G${run}${n}`, bonus: true, name: 'Welcome 5 TH/s', th: 5, hall: 'tx-1', days: 30, dailyUsd: 0.1, price: 0, startedAt: Date.now(), online: true, status: 'active' });

before(async () => {
  await migrate();
});

after(async () => {
  await pool().end();
});

test('a refund removes the miner and puts the price back as a logged balance entry', async () => {
  const id = await account('ok');
  await credit(id, 0.01);
  const before = await availOf(id);
  const serial = await buy(id);
  assert.ok((await availOf(id)) < before - 0.0001);

  const r = await refund(id, serial);
  assert.ok(r.ok, r.error);
  assert.equal(r.usd, starter().price);
  assert.ok(Math.abs((await availOf(id)) - before) < 3e-8, 'the balance is back where it started');

  const u = await getUser(id);
  assert.equal(u.contracts.length, 0);
  assert.equal(u.history[0].kind, 'adjustment');
  assert.match(u.history[0].label, /^Refund/);
  assert.ok(u.notifications.some((n) => n.title === 'Refund'));
  const rows = (await q("SELECT btc, usd, ref FROM ledger WHERE user_id = $1 AND kind = 'adjust'", [id])).rows;
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].usd), starter().price);
  assert.ok(Math.abs(Number(rows[0].btc) - r.btc) < 1e-9);
  assert.match(rows[0].ref, new RegExp(serial));
});

test('a refund cannot be taken twice, and an unknown miner is refused', async () => {
  const id = await account('twice');
  await credit(id, 0.01);
  const serial = await buy(id);
  assert.ok((await refund(id, serial)).ok);
  assert.equal((await refund(id, serial)).status, 404);
  assert.equal((await refund(id, 'OP-0000000')).status, 404);
  assert.equal((await refund(`nobody-${run}@test.dev`, serial)).status, 404);
});

test('two refunds at the same moment pay out once', async () => {
  const id = await account('race');
  await credit(id, 0.01);
  const before = await availOf(id);
  const serial = await buy(id);
  const res = await Promise.all([refund(id, serial), refund(id, serial)]);
  assert.equal(res.filter((r) => r.ok).length, 1);
  assert.ok(Math.abs((await availOf(id)) - before) < 3e-8);
});

test('outside the window nothing is refunded: after 24 hours, or after the first payout day', async () => {
  const id = await account('window');
  await credit(id, 0.01);
  const serial = await buy(id);
  const start = (await getUser(id)).contracts[0].startedAt;

  const late = await refundMiner(id, serial, start + 25 * HOUR);
  assert.equal(late.status, 409);
  assert.match(late.error, /24 hours/);

  // Bought at 23:00 UTC; at 01:00 UTC the day has finished, so the first payout is due even though it is under 24 hours.
  const T = Date.UTC(2026, 0, 10, 23, 0, 0);
  await withUser(id, (u) => {
    u.contracts[0].startedAt = T;
  });
  const paid = await refundMiner(id, serial, T + 2 * HOUR);
  assert.equal(paid.status, 409);
  assert.match(paid.error, /payout day/);

  assert.equal((await getUser(id)).contracts.length, 1, 'the miner is still there');
});

test('granted miners, welcome gifts and the demo account are not refunded', async () => {
  const id = await account('grant');
  const g = await miners.grantPlan(id, 'starter');
  assert.ok(g.ok);
  const r = await refund(id, g.contract.serial);
  assert.equal(r.status, 409);
  assert.match(r.error, /not paid for/);

  const gf = gift('a');
  await withUser(id, (u) => {
    u.contracts.push(gf);
  });
  const r2 = await refund(id, gf.serial);
  assert.equal(r2.status, 409);
  assert.match(r2.error, /gift/);

  assert.equal((await refund('demo', 'OP-0000001')).ok, false);
  assert.equal((await getUser(id)).contracts.length, 2, 'nothing was removed');
  assert.equal((await q("SELECT count(*)::int AS n FROM ledger WHERE user_id = $1 AND kind = 'adjust'", [id])).rows[0].n, 0, 'nothing was paid');
});

test('the welcome gift goes with the last paid miner, and stays while another one remains', async () => {
  const id = await account('gift');
  await credit(id, 0.02);
  const gf = gift('b');
  await withUser(id, (u) => {
    u.contracts.push(gf);
  });
  const a = await buy(id);
  const b = await buy(id);

  const r1 = await refund(id, a);
  assert.ok(r1.ok, r1.error);
  assert.equal(r1.gifts, 0);
  assert.deepEqual((await getUser(id)).contracts.map((c) => c.serial).sort(), [b, gf.serial].sort());

  const r2 = await refund(id, b);
  assert.ok(r2.ok, r2.error);
  assert.equal(r2.gifts, 1);
  assert.equal((await getUser(id)).contracts.length, 0);
});

test('a miner paid by crypto (approved order) is refunded the same way', async () => {
  const id = await account('crypto');
  const plan = starter();
  const o = { id: `ord_${run}_c`, plan: { ...plan }, usd: plan.price, status: 'pending', at: Date.now() };
  await q('INSERT INTO orders (id, user_id, status, at, data, idem_key) VALUES ($1, $2, $3, $4, $5::jsonb, NULL)', [o.id, id, 'pending', o.at, JSON.stringify(o)]);
  const ap = await miners.reviewOrder(id, o.id, 'approve');
  assert.ok(ap.ok, ap.error);
  const before = await availOf(id);

  const r = await refund(id, ap.serial);
  assert.ok(r.ok, r.error);
  assert.equal(r.usd, plan.price);
  assert.ok((await availOf(id)) > before, 'the price is credited to the balance');
  assert.equal((await getUser(id)).contracts.length, 0);
});
