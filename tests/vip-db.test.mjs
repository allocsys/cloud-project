// VIP levels: the level comes from own spend or active friends and never drops, a friend keeps the rates of the inviter's level
// at the time the friend's reward started, monthly tickets are given once a month, and the admin table is checked.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, getUser } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');
const miners = await import('@/lib/server/miners');
const referrals = await import('@/lib/server/referrals');
const boost = await import('@/lib/server/boost');

const run = `vp${Date.now().toString(36)}`;
const email = (n) => `${n}-${run}@test.dev`;
const PW = 'correct horse 1';
const SMALL = { planId: 'custom', th: 15, days: 90 };
const ROW = { minSpendUsd: 1000000, minFriends: 1, friendMinUsd: 1, firstPct: 8, dailyPct: 3, capPct: 12, monthlyLimit: 30, ticketsPerMonth: 2 };

before(async () => {
  await migrate();
});

after(async () => {
  await referrals.resetSettings();
  await boost.saveBoostSettings({ enabled: false });
  await pool().end();
});

test('level: highest tier reached by spend or active friends, never lower than the peak', () => {
  const S = referrals.settings();
  const u = (price, peak) => ({ contracts: price ? [{ plan: 'Custom', price }] : [], vipPeak: peak || 0 });
  assert.equal(referrals.vipOf(u(0), 0, S).level, 0);
  assert.equal(referrals.vipOf(u(0), 2, S).level, 0, 'two friends are not enough for VIP 1');
  assert.equal(referrals.vipOf(u(0), 3, S).level, 1, 'three active friends');
  assert.equal(referrals.vipOf(u(600), 0, S).level, 2, 'spend alone');
  assert.equal(referrals.vipOf(u(0, 3), 0, S).level, 3, 'the peak is kept');
  assert.equal(referrals.vipOf(u(0), 100, S).level, 15, 'the top level');
  assert.equal(referrals.vipOf(u(75000), 0, S).level, 15, 'the top level by spend');
  assert.equal(S.vip.length, 15);
  assert.equal(referrals.vipOf({ contracts: [{ plan: 'Custom', price: 5000, bonus: true }], vipPeak: 0 }, 0, S).level, 0, 'gift miners do not count');
});

test('the admin table is checked', async () => {
  const bad = async (vip) => assert.equal((await referrals.saveSettings({ vip })).ok, false);
  await bad([]);
  await bad([{ ...ROW, minSpendUsd: 0, minFriends: 0 }]);
  await bad([{ ...ROW, firstPct: 99 }]);
  await bad([{ ...ROW, monthlyLimit: 1.5 }]);
  await bad([ROW, { ...ROW, minSpendUsd: 10 }]); // a higher level cannot ask for less
  await bad([{ ...ROW, firstPct: 2 }]); // lower than VIP 0
  await bad([{ ...ROW, firstPct: 8, capPct: 7 }]); // cap below the first reward
  await bad([ROW, { ...ROW, minFriends: 2, dailyPct: 1 }]); // rates cannot drop at a higher level
  await bad([{ ...ROW, friendMinUsd: 99999 }]);
  await bad(Array(16).fill(ROW)); // at most 15 levels
  const { minSpendUsd, ...noSpend } = ROW;
  await bad([noSpend]);
  assert.equal((await referrals.saveSettings({ vip: Array(15).fill(ROW) })).ok, true);
  assert.equal(referrals.settings().vip.length, 15);
  assert.equal((await referrals.saveSettings({ vip: [ROW] })).ok, true);
  assert.equal(referrals.settings().vip.length, 1);
  assert.equal((await referrals.saveSettings({ monthlyLimit: 20 })).ok, true);
  assert.equal(referrals.settings().vip.length, 1, 'a save that leaves the table out keeps it');
});

async function friend(name, code) {
  assert.equal((await auth.signup({ email: email(name), password: PW, ref: code })).ref, 'applied');
  assert.ok((await miners.grantPlan(email(name), SMALL)).ok);
  return getUser(email(name));
}

test('a friend keeps the rates of the level the inviter had when the reward started', async () => {
  assert.equal((await referrals.saveSettings({ vip: [ROW] })).ok, true); // VIP 1 needs 1 active friend (spend is out of reach)
  assert.ok((await auth.signup({ email: email('inv'), password: PW })).ok);
  assert.ok((await miners.grantPlan(email('inv'), SMALL)).ok);
  const inv = await getUser(email('inv'));
  assert.equal(referrals.vipOf(inv, 0).level, 0, 'the inviter starts at VIP 0 (own spend is below the table)');

  const f1 = await friend('f1', inv.refCode);
  assert.equal(f1.refRates.vip, 0);
  assert.equal(f1.refRates.firstPct, referrals.settings().firstPct, 'locked at the plain rates');
  assert.equal((await getUser(email('inv'))).vipPeak, 1, 'the first active friend lifts the inviter');

  const f2 = await friend('f2', inv.refCode);
  assert.equal(f2.refRates.vip, 1);
  assert.equal(f2.refRates.firstPct, ROW.firstPct);
  assert.equal(f2.refRates.dailyPct, ROW.dailyPct);
  assert.equal(f2.refRates.capPct, ROW.capPct);

  // An admin change later does not touch what f1 and f2 locked.
  assert.equal((await referrals.saveSettings({ vip: [{ ...ROW, firstPct: 9 }] })).ok, true);
  assert.equal((await getUser(email('f2'))).refRates.firstPct, ROW.firstPct);
  const view = referrals.vipViewOf(await referrals.getRefCtx(email('inv')));
  assert.equal(view.level, 1);
  assert.equal(view.friends, 2);
  assert.equal(view.next, null, 'only one level above VIP 0 in this table');
});

test('monthly tickets: given once a month, only while boost tickets are on', async () => {
  assert.equal((await referrals.saveSettings({ vip: [ROW] })).ok, true);
  const held = async () => (await getUser(email('inv'))).freeTickets || 0;

  await boost.saveBoostSettings({ enabled: false });
  const a = await held();
  assert.equal(await referrals.claimVipTickets(email('inv')), 0, 'tickets off: nothing given');
  assert.equal(await held(), a);

  await boost.saveBoostSettings({ enabled: true });
  assert.equal(await referrals.claimVipTickets(email('inv')), ROW.ticketsPerMonth);
  assert.equal(await held(), a + ROW.ticketsPerMonth);
  assert.equal(await referrals.claimVipTickets(email('inv')), 0, 'a second visit the same month gives nothing');
  assert.equal(await held(), a + ROW.ticketsPerMonth);
});

test('a friend whose first purchase is too small does not count toward VIP', async () => {
  assert.equal((await referrals.saveSettings({ vip: [{ ...ROW, friendMinUsd: 10000 }] })).ok, true);
  assert.equal(referrals.vipViewOf(await referrals.getRefCtx(email('inv'))).friends, 0);
  assert.equal((await referrals.saveSettings({ vip: [ROW] })).ok, true);
  assert.equal(referrals.vipViewOf(await referrals.getRefCtx(email('inv'))).friends, 2);
});

test('each level sets its own smallest first purchase for a friend', () => {
  const S = { ...referrals.settings(), vip: [{ ...ROW, friendMinUsd: 50 }, { ...ROW, minSpendUsd: 2000000, friendMinUsd: 100 }] };
  const u = { contracts: [], vipPeak: 0 };
  assert.equal(referrals.vipOf(u, [60], S).level, 1, '$60 is enough for VIP 1');
  assert.equal(referrals.vipOf(u, [120], S).level, 2, '$120 reaches VIP 2');
  assert.equal(referrals.vipOf(u, [40], S).level, 0, 'below the minimum');
});

test('rates of a later-month friend and of an older friend are locked once', async () => {
  const set = (id, sql) => pool().query(`UPDATE users SET data = ${sql} WHERE id = $1`, [id]);
  await friend('f3', (await getUser(email('inv'))).refCode);
  await friend('f4', (await getUser(email('inv'))).refCode);
  // f3 looks like an older friend (no saved rates), f4 like a friend held for a later month (rates pending).
  await set(email('f3'), "data - 'refRates'");
  await set(email('f4'), "(data - 'refRates') || '{\"refRatesPending\": true}'::jsonb");
  await referrals.getRefCtx(email('inv')); // reading locks them
  const S = referrals.settings();
  const f3 = await getUser(email('f3'));
  const f4 = await getUser(email('f4'));
  assert.equal(f3.refRates.vip, 0);
  assert.equal(f3.refRates.firstPct, S.firstPct, 'an older friend gets the plain numbers');
  assert.equal(f4.refRates.vip, 1);
  assert.equal(f4.refRates.firstPct, S.vip[0].firstPct, 'a later-month friend gets the level held when the reward starts');
  assert.equal(f4.refRatesPending, undefined);
  // Locked: a later table change does not move them.
  assert.equal((await referrals.saveSettings({ vip: [{ ...ROW, firstPct: 9 }] })).ok, true);
  await referrals.getRefCtx(email('inv'));
  assert.equal((await getUser(email('f4'))).refRates.firstPct, S.vip[0].firstPct);
});

test('levels that users hold cannot be removed', async () => {
  assert.equal((await referrals.saveSettings({ vip: [ROW, { ...ROW, minFriends: 2 }] })).ok, true);
  await pool().query("UPDATE users SET data = jsonb_set(data, '{vipPeak}', '2') WHERE id = $1", [email('inv')]);
  assert.equal((await referrals.saveSettings({ vip: [ROW] })).ok, false, 'VIP 2 is held by a user');
  assert.equal((await referrals.saveSettings({ vip: [ROW, { ...ROW, minFriends: 2 }] })).ok, true);
});
