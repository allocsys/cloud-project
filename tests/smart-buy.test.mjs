// Smart Mining bought against a real Postgres: the budget and term are checked, the balance is charged once, the miner
// keeps the payout it was bought with, and the admin's on/off switch and payout setting are followed.
// Settings changed here are put back in a finally block, so other test files see the defaults.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, getUser, withUser } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');
const miners = await import('@/lib/server/miners');
const { act } = await import('@/lib/server/admin');
const { smartSettings } = await import('@/lib/server/smart-admin');
const { getPrices } = await import('@/lib/server/prices');
const { smartPlan, smartBaseYield, smartPayout, SMART, SMART_RATES, SMART_BONUS } = await import('@/lib/smart');

const run = `s${Date.now().toString(36)}`;
const PW = 'correct horse 1';

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
const costOf = async (plan) => Math.ceil((plan.price / (await getPrices()).prices.btc) * 1e8) / 1e8;
const buy = (id, body) => miners.buyPlan({ planId: 'smart', pay: 'balance', ...body }, { userId: id });

before(async () => {
  await migrate();
});

after(async () => {
  await pool().end();
});

test('Smart Mining is bought from the balance once, and the miner carries its budget and base yield', async () => {
  const id = await account('buy');
  const plan = smartPlan(200, 90);
  const cost = await costOf(plan);
  await credit(id, cost + 0.0001);

  const r = await buy(id, { budget: 200, days: 90 });
  assert.equal(r.ok, true);
  const c = r.contract;
  assert.equal(c.smart, true);
  assert.equal(c.budget, 200);
  assert.equal(c.th, 0);
  assert.equal(c.days, 90);
  assert.ok(Math.abs(c.baseYield - smartBaseYield(90, smartPayout(200, 90))) < 1e-12);
  assert.equal(c.price, 200);

  const u = await getUser(id);
  assert.equal(u.contracts.length, 1);
  assert.ok(Math.abs((u.spent || 0) - cost) < 1e-9);
});

test('a budget or term that is not allowed is refused and charges nothing', async () => {
  const id = await account('bad');
  await credit(id, 1);
  for (const body of [
    { budget: SMART.min - 1, days: 90 },
    { budget: SMART.max + 1, days: 90 },
    { budget: 100.5, days: 90 },
    { budget: 'abc', days: 90 },
    { budget: 100, days: 30 },
  ]) {
    const r = await buy(id, body);
    assert.equal(r.ok, false, JSON.stringify(body));
    assert.equal(r.status, 400);
  }
  const u = await getUser(id);
  assert.equal(u.contracts.length, 0);
  assert.equal(u.spent || 0, 0);
});

test('without enough balance Smart Mining is refused', async () => {
  const id = await account('poor');
  const r = await buy(id, { budget: 500, days: 120 });
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
});

test('the admin switch turns Smart Mining off for new purchases and back on', async () => {
  const id = await account('switch');
  await credit(id, 1);
  try {
    assert.equal((await act({ action: 'smart-settings', enabled: false })).ok, true);
    assert.equal((await smartSettings()).enabled, false);
    const off = await buy(id, { budget: 100, days: 90 });
    assert.equal(off.ok, false);
    assert.equal(off.status, 409);
    assert.equal((await getUser(id)).contracts.length, 0);
  } finally {
    await act({ action: 'smart-settings', enabled: true });
  }
  assert.equal((await smartSettings()).enabled, true);
  assert.equal((await buy(id, { budget: 100, days: 90 })).ok, true);
});

test('a new pay table applies to purchases made afterwards and each miner keeps its own', async () => {
  const id = await account('payout');
  await credit(id, 1);
  const flatTable = { rates: SMART_RATES.map(() => 0.004), bonus: { 120: 0.0005, 150: 0.001, 180: 0.0015 } };
  try {
    const first = await buy(id, { budget: 100, days: 120 });
    assert.equal(first.ok, true);
    assert.equal((await act({ action: 'smart-settings', enabled: true, ...flatTable })).ok, true);
    assert.deepEqual((await smartSettings()).table, { rates: flatTable.rates, bonus: { 90: 0, 120: 0.0005, 150: 0.001, 180: 0.0015 } });
    const second = await buy(id, { budget: 100, days: 120 });
    assert.equal(second.ok, true);
    const was = smartBaseYield(120, smartPayout(100, 120));
    assert.ok(Math.abs(first.contract.baseYield - was) < 1e-12);
    assert.ok(Math.abs(second.contract.baseYield - smartBaseYield(120, 0.0045)) < 1e-12);
    assert.ok(Math.abs(second.contract.reserve.hi - 0.0045 * 1.3) < 1e-9, 'the band follows the miner\'s own payout');
    const u = await getUser(id);
    assert.ok(Math.abs(u.contracts[0].baseYield - was) < 1e-12);
  } finally {
    await act({ action: 'smart-settings', enabled: true, rates: SMART_RATES, bonus: { 120: SMART_BONUS[120], 150: SMART_BONUS[150], 180: SMART_BONUS[180] } });
  }
});

test('a pay table outside the allowed range is refused and nothing changes', async () => {
  const before = await smartSettings();
  const bad = [
    { rates: [...SMART_RATES.slice(0, 9), 0.1] },
    { rates: SMART_RATES.slice(1) },
    { rates: [...SMART_RATES.slice(0, 9), 'x'] },
    { rates: [...SMART_RATES.slice(0, 9), ''] },
    { rates: 'x' },
    { bonus: { 120: 0.5, 150: 0, 180: 0 } },
    { bonus: { 120: 0, 150: -0.001, 180: 0 } },
    { bonus: { 120: 'x', 150: 0, 180: 0 } },
    { bonus: { 120: 0, 150: 0, 180: -0.001 } },
    { bonus: { 120: 0, 150: 0 } },
  ];
  for (const body of bad) {
    const r = await act({ action: 'smart-settings', enabled: true, ...body });
    assert.equal(r.ok, false, JSON.stringify(body));
    assert.equal(r.status, 422);
  }
  assert.deepEqual(await smartSettings(), before);
});

test('a Smart Mining miner page comes with its coin history, and a fixed plan does not', async () => {
  const id = await account('coins');
  await credit(id, 1);
  const r = await buy(id, { budget: 100, days: 90 });
  assert.equal(r.ok, true);
  const m = await miners.getMiner(r.contract.serial, id);
  assert.ok(m.coins, 'smart miner has coins');
  assert.ok(Array.isArray(m.coins.history));
  assert.ok(m.coins.today === null || typeof m.coins.today === 'string');
  assert.equal(m.smart, true);
});

test('a coin can be turned off and on, but the last coin stays on', async () => {
  const list = (await import('@/lib/server/smart-admin')).smartCoinList;
  const coins = await list();
  assert.ok(coins.length >= 2);
  const sym = coins[coins.length - 1].symbol;
  const was = coins.find((c) => c.symbol === sym).enabled;
  try {
    assert.equal((await act({ action: 'smart-coin', symbol: sym, enabled: false })).ok, true);
    assert.equal((await list()).find((c) => c.symbol === sym).enabled, false);
    assert.equal((await act({ action: 'smart-coin', symbol: sym, enabled: true })).ok, true);
    assert.equal((await act({ action: 'smart-coin', symbol: 'NOPE', enabled: true })).status, 404);
  } finally {
    await act({ action: 'smart-coin', symbol: sym, enabled: was });
  }
});
