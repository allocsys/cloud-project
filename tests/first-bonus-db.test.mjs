// The first-buy bonus against a real Postgres: it is on only when the admin says so, goes to the first buy paid with crypto only (once, even when
// two orders settle at the same moment), is fixed on the miner when it starts, and is announced with one notification.
// Settings changed here are put back in the after hook, so other test files see the defaults (bonus off).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, q, getUser, withUser } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');
const miners = await import('@/lib/server/miners');
const { act } = await import('@/lib/server/admin');
const { customPlan } = await import('@/lib/data');
const { smartPlan } = await import('@/lib/smart');

const run = `f${Date.now().toString(36)}`;
const PW = 'correct horse 1';
let n = 0;

async function account(name) {
  const e = `${name}-${run}@test.dev`;
  assert.ok((await auth.signup({ email: e, password: PW })).ok);
  return e;
}
const credit = (id, btc) =>
  withUser(id, (u) => {
    u.withdrawn = (u.withdrawn || 0) - btc;
  });
const settings = (extra = {}) => act({ action: 'firstbonus-settings', enabled: true, pct: 10, capTh: 5, capUsd: 50, minUsd: 0, until: '', ...extra });
const asics = () => customPlan(15, 90, miners.getCatalog().halls); // 15 TH/s, 90 days
// Pays an order the way the provider callback does: an order row, then a finished payment for it.
async function crypto(id, plan = asics()) {
  const oid = `ord_${run}_${++n}`;
  const order = { id: oid, plan, usd: plan.price, status: 'pending', at: Date.now() };
  await q('INSERT INTO orders (id, user_id, status, at, data, idem_key) VALUES ($1, $2, $3, $4, $5::jsonb, NULL)', [oid, id, 'pending', order.at, JSON.stringify(order)]);
  const r = await miners.settleOrder({ order_id: oid, payment_status: 'finished', price_amount: plan.price, price_currency: 'usd' });
  assert.equal(r.ok, true);
  return getUser(id);
}

before(async () => {
  await migrate();
});

after(async () => {
  await act({ action: 'firstbonus-settings', enabled: false, pct: 10, capTh: 5, capUsd: 50, minUsd: 50, until: '' });
  await pool().end();
});

test('a first crypto buy of ASICs power gets extra TH/s, fixed on the miner, with one notification', async () => {
  assert.equal((await settings()).ok, true);
  const id = await account('asic');
  const plan = asics();
  const u = await crypto(id, plan);
  const c = u.contracts[0];
  assert.equal(c.th, 16.5);
  assert.deepEqual(c.firstBonus, { pct: 10, th: 1.5 });
  assert.equal(c.bonus, undefined, 'not the gift marker');
  assert.equal(c.price, plan.price, 'the price is what was paid');
  assert.equal(c.name, 'Custom 16.5 TH/s');
  assert.ok(c.dailyUsd > parseFloat(plan.daily.replace('$', '')));
  assert.ok(u.firstBuy > 0);
  const note = u.notifications.filter((x) => x.title === 'First-buy bonus added');
  assert.equal(note.length, 1);
  assert.equal(note[0].body, `${c.serial} includes +1.5 TH/s bonus hashrate.`);
  assert.equal(u.notifications[0].title, 'First-buy bonus added');
  assert.equal(u.history.find((h) => h.kind === 'purchase').amount, `-$${plan.price.toFixed(2)}`);

  // A later change of the settings does not touch it, and the next buy gets nothing.
  assert.equal((await settings({ pct: 50 })).ok, true);
  assert.equal((await getUser(id)).contracts[0].th, 16.5);
  const u2 = await crypto(id, plan);
  assert.equal(u2.contracts[1].th, 15);
  assert.equal(u2.contracts[1].firstBonus, undefined);
  assert.equal(u2.notifications.filter((x) => x.title === 'First-buy bonus added').length, 1);
});

test('a first crypto buy of Smart Mining gets a higher profit rate, with the budget unchanged', async () => {
  assert.equal((await settings()).ok, true);
  const id = await account('smart');
  const plan = smartPlan(100, 90);
  const u = await crypto(id, plan);
  const c = u.contracts[0];
  assert.equal(c.smart, true);
  assert.equal(c.budget, 100);
  assert.equal(c.price, 100);
  assert.ok(c.baseYield > plan.baseYield);
  assert.ok(c.firstBonus.pct > 9 && c.firstBonus.pct < 11, `about 10%, got ${c.firstBonus.pct}`);
  assert.ok(c.firstBonus.usd > 0);
  assert.ok(c.reserve.hi > plan.reserve.hi, 'the reserve band follows the higher rate');
  const note = u.notifications[0];
  assert.equal(note.title, 'First-buy bonus added');
  assert.equal(note.body, `${c.serial} includes +${c.firstBonus.pct}% bonus hashrate.`);
});

test('a first buy paid from the balance gets nothing and uses the chance up', async () => {
  assert.equal((await settings()).ok, true);
  const id = await account('bal');
  await credit(id, 1);
  const r = await miners.buyPlan({ planId: 'custom', th: 15, days: 90, pay: 'balance' }, { userId: id });
  assert.ok(r.ok);
  assert.equal(r.contract.th, 15);
  assert.equal(r.firstBonus, undefined);
  const u = await crypto(id);
  assert.equal(u.contracts[1].th, 15, 'the next buy is not a first buy');
  assert.equal(u.notifications.some((x) => x.title === 'First-buy bonus added'), false);
});

test('two orders paid at the same moment give the bonus once', async () => {
  assert.equal((await settings()).ok, true);
  const id = await account('twice');
  await Promise.all([crypto(id), crypto(id)]);
  const u = await getUser(id);
  assert.equal(u.contracts.length, 2);
  assert.equal(u.contracts.filter((c) => c.firstBonus).length, 1);
  assert.equal(u.notifications.filter((x) => x.title === 'First-buy bonus added').length, 1);
});

test('off, past its last day, or below the minimum: no bonus', async () => {
  const a = await account('off');
  assert.equal((await settings({ enabled: false })).ok, true);
  assert.equal((await crypto(a)).contracts[0].th, 15);

  const b = await account('late');
  assert.equal((await settings({ until: '2020-01-01' })).ok, true);
  assert.equal((await crypto(b)).contracts[0].th, 15);

  const c = await account('min');
  assert.equal((await settings({ minUsd: 5000 })).ok, true);
  assert.equal((await crypto(c)).contracts[0].th, 15);
});

test('the bonus is capped, and an end date still open counts', async () => {
  assert.equal((await settings({ pct: 100, capTh: 2, until: '2099-12-31' })).ok, true);
  const id = await account('cap');
  const c = (await crypto(id)).contracts[0];
  assert.equal(c.th, 17);
  assert.deepEqual(c.firstBonus, { pct: 13.3, th: 2 });
});

test('getMiners shows the settings only while the bonus is on and the account has not made a paid buy', async () => {
  const id = await account('seen');
  assert.equal((await settings({ enabled: false })).ok, true);
  assert.equal((await miners.getMiners(id)).firstBonus, undefined);
  assert.equal((await settings()).ok, true);
  const seen = (await miners.getMiners(id)).firstBonus;
  assert.equal(seen.pct, 10);
  assert.equal(seen.capTh, 5);
  await crypto(id);
  assert.equal((await miners.getMiners(id)).firstBonus, undefined);
});

test('the admin settings refuse bad numbers and dates, and keep what was not sent', async () => {
  assert.equal((await settings()).ok, true);
  assert.equal((await settings({ pct: 0 })).status, 422);
  assert.equal((await settings({ pct: 101 })).status, 422);
  assert.equal((await settings({ capTh: 'x' })).status, 422);
  assert.equal((await settings({ until: '31/12/2026' })).status, 422);
  const r = await act({ action: 'firstbonus-settings', enabled: false });
  assert.equal(r.ok, true);
  assert.equal(r.settings.enabled, false);
  assert.equal(r.settings.pct, 10, 'the rest stays as it was');
});
