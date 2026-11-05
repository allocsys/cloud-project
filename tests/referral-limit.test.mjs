// A friend whose first purchase comes when the inviter already has monthlyLimit rewarded friends this month:
// 'never' (the default) leaves them unrewarded; 'later' starts their reward on the first day of the first month with room.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, getUser } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');
const miners = await import('@/lib/server/miners');
const referrals = await import('@/lib/server/referrals');

const run = `rl${Date.now().toString(36)}`;
const email = (n) => `${n}-${run}@test.dev`;
const PW = 'correct horse 1';
const SMALL = { planId: 'custom', th: 15, days: 90 };

before(async () => {
  await migrate();
});

after(async () => {
  await referrals.resetSettings();
  await pool().end();
});

async function friend(name, code) {
  assert.equal((await auth.signup({ email: email(name), password: PW, ref: code })).ref, 'applied');
  assert.ok((await miners.grantPlan(email(name), SMALL)).ok);
  return getUser(email(name));
}

test('over the monthly limit: never by default, from the first month with room when the admin says so', async () => {
  assert.ok((await auth.signup({ email: email('inv'), password: PW })).ok);
  assert.ok((await miners.grantPlan(email('inv'), SMALL)).ok); // a plan lifts the invite limit
  const code = (await getUser(email('inv'))).refCode;
  assert.equal((await referrals.saveSettings({ monthlyLimit: 1, vip: [{ minSpendUsd: 1000000, minFriends: 100000, firstPct: 4, dailyPct: 1.5, capPct: 6, monthlyLimit: 1, ticketsPerMonth: 0 }] })).ok, true); // an unreachable VIP level with the same limit
  assert.equal(referrals.settings().overLimit, 'never');

  const now = new Date();
  const monthStart = (k) => new Date(now.getFullYear(), now.getMonth() + k, 1).getTime();

  const f1 = await friend('f1', code);
  assert.ok(f1.refRewardAt && f1.refRewardAt < monthStart(1), 'the first friend is rewarded now');
  const f2 = await friend('f2', code);
  assert.ok(f2.refBonusAt, 'the gift is still given');
  assert.equal(f2.refRewardAt, undefined, 'never: no reward, now or later');

  assert.equal((await referrals.saveSettings({ monthlyLimit: 1, overLimit: 'later' })).ok, true);
  const f3 = await friend('f3', code);
  assert.equal(f3.refRewardAt, monthStart(1), 'later: the first day of next month');
  const f4 = await friend('f4', code);
  assert.equal(f4.refRewardAt, monthStart(2), 'next month is taken by f3, so the one after');

  // Nothing is paid before the start, and the Referrals tab can say when it starts.
  const ctx = await referrals.getRefCtx(email('inv'));
  const rows = Object.fromEntries(referrals.summaryOf(ctx).friends.map((r) => [r.id, r]));
  assert.equal(rows[email('f1')].status, 'active');
  assert.equal(rows[email('f3')].status, 'pending');
  assert.equal(Number(rows[email('f3')].earned), 0);
  assert.equal(referrals.historyOfCtx(ctx).some((h) => h.label.includes('f3')), false);
  const link = (await referrals.adminView()).links.find((l) => l.friend === email('f3'));
  assert.equal(link.rewarded, false);
  assert.equal(link.startsAt, monthStart(1));
  assert.equal(link.rewardUsd, 0);
});

test('the setting is checked', async () => {
  assert.equal((await referrals.saveSettings({ overLimit: 'sometimes' })).ok, false);
  assert.equal((await referrals.saveSettings({ overLimit: ' later ' })).ok, true);
  assert.equal(referrals.settings().overLimit, 'later');
  assert.equal((await referrals.saveSettings({ monthlyLimit: 5 })).ok, true);
  assert.equal(referrals.settings().overLimit, 'later', 'a save that leaves it out keeps it');
});
