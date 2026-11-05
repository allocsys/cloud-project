// VIP levels: the level comes from own spend or active friends in the last 90 days and drops one step a month, a friend keeps the rates of the inviter's level
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

test('level: highest tier reached by spend or active friends in the last 90 days', () => {
  const S = referrals.settings();
  const u = (price) => ({ contracts: price ? [{ plan: 'Custom', price }] : [] });
  assert.equal(referrals.vipOf(u(0), 0, S).level, 0);
  assert.equal(referrals.vipOf(u(0), 2, S).level, 0, 'two friends are not enough for VIP 1');
  assert.equal(referrals.vipOf(u(0), 3, S).level, 1, 'three active friends');
  assert.equal(referrals.vipOf(u(600), 0, S).level, 2, 'spend alone');
  assert.equal(referrals.vipOf(u(0), 100, S).level, 15, 'the top level');
  assert.equal(referrals.vipOf(u(75000), 0, S).level, 15, 'the top level by spend');
  assert.equal(S.vip.length, 15);
  assert.equal(referrals.vipOf({ contracts: [{ plan: 'Custom', price: 5000, bonus: true }] }, 0, S).level, 0, 'gift miners do not count');
});

test('level drops one step a month once the spend is out of the last 90 days', () => {
  const S = referrals.settings();
  const D = 86400000;
  const now = Date.now();
  const u = (price, ago, days = 90) => ({ contracts: [{ plan: 'Custom', price, days, startedAt: now - ago * D }] });
  const at = (user, firsts = 0) => referrals.vipOf(user, firsts, S, now).level;
  assert.equal(at(u(10000, 5)), 8, 'bought this week');
  assert.equal(at(u(10000, 85)), 8, 'still inside the quarter');
  assert.equal(at(u(10000, 95)), 7, 'one month after it left the quarter');
  assert.equal(at(u(10000, 125)), 6, 'two months');
  assert.equal(at(u(10000, 155)), 5, 'three months');
  assert.equal(at(u(10000, 200, 365)), 8, 'a miner that is still running keeps counting');
  assert.equal(at(u(500, 100)), 1, 'VIP 2 drops to VIP 1');
  assert.equal(at(u(500, 130)), 0, 'and then to VIP 0');
  const friends = (ago) => Array.from({ length: 5 }, () => ({ at: now - ago * D, x: 100 }));
  const none = { contracts: [] };
  assert.equal(at(none, friends(5)), 2, 'five fresh friends');
  assert.equal(at(none, friends(95)), 1, 'friends older than a quarter count one level lower');
  assert.equal(at(none, friends(130)), 0);
  const keep = referrals.vipKeepsUntil(u(10000, 5), 0, S, now);
  assert.ok(Math.abs(keep - (now + 85 * D)) <= D, 'keeps VIP 8 for about 85 more days');
  assert.equal(referrals.vipKeepsUntil({ contracts: [] }, 0, S, now), null, 'nothing to keep at VIP 0');
});

test('keeps-until is found from event times and matches a day-by-day check', () => {
  const S = referrals.settings();
  const D = 86400000;
  const now = Date.now();
  const near = (got, days) => assert.ok(got !== null && Math.abs(got - (now + days * D)) <= D, `expected about ${days} days, got ${got === null ? null : (got - now) / D}`);
  const u = (price, ago, days = 90) => ({ contracts: [{ plan: 'Custom', price, days, startedAt: now - ago * D }] });
  near(referrals.vipKeepsUntil(u(10000, 5, 365), 0, S, now), 360); // a running miner holds the level until it ends
  const friends = Array.from({ length: 5 }, () => ({ at: now - 5 * D, x: 100 }));
  near(referrals.vipKeepsUntil({ contracts: [] }, friends, S, now), 85); // friends hold it until their quarter ends
  assert.equal(referrals.vipKeepsUntil({ contracts: [{ plan: 'Custom', price: 10000, bonus: true }] }, 0, S, now), null, 'gift miners hold nothing');
  // The old way: ask for the level every day and take the first day it is lower.
  const slow = (user, firsts) => {
    const level = referrals.vipOf(user, firsts, S, now).level;
    if (!level) return null;
    for (let d = 1; d <= 600; d += 1) if (referrals.vipOf(user, firsts, S, now + d * D).level < level) return now + d * D;
    return null;
  };
  const cases = [[u(10000, 5), 0], [u(500, 40), 0], [u(2500, 70, 120), 0], [{ contracts: [] }, friends], [u(1000, 10), friends], [{ contracts: [...u(700, 30).contracts, ...u(900, 3, 200).contracts] }, 0]];
  for (const [user, firsts] of cases) {
    const fast = referrals.vipKeepsUntil(user, firsts, S, now);
    const old = slow(user, firsts);
    if (old === null) assert.equal(fast, null);
    else assert.ok(fast !== null && fast > old - D && fast <= old, 'same day as the day-by-day answer');
  }
});

test('a level held by decay says what keeps it', () => {
  const S = referrals.settings();
  const D = 86400000;
  const mine = (ago) => ({ contracts: [{ plan: 'Custom', price: 10000, days: 90, startedAt: Date.now() - ago * D }] });
  const fresh = referrals.vipViewOf({ u: mine(5), friends: [], S });
  assert.equal(fresh.level, 8);
  assert.equal(fresh.hold, null, 'earned now: nothing to add');
  const held = referrals.vipViewOf({ u: mine(95), friends: [], S });
  assert.equal(held.level, 7, 'one step down');
  assert.equal(held.hold.leftUsd, S.vip[6].minSpendUsd, 'what VIP 7 asks for, as nothing counts now');
  assert.equal(held.hold.leftFriends, S.vip[6].minFriends);
});

test('the admin table is checked', async () => {
  const bad = async (vip) => assert.equal((await referrals.saveSettings({ vip })).ok, false);
  await bad([]);
  await bad([{ ...ROW, minSpendUsd: 0, minFriends: 0 }]);
  await bad([{ ...ROW, firstPct: 99 }]);
  await bad([{ ...ROW, firstPct: 11 }]); // above the margin limits
  await bad([{ ...ROW, dailyPct: 6 }]);
  await bad([{ ...ROW, capPct: 17 }]);
  assert.equal((await referrals.saveSettings({ capPct: 17 })).ok, false, 'the plain cap has the same limit');
  await bad([{ ...ROW, monthlyLimit: 1.5 }]);
  await bad([ROW, { ...ROW, minSpendUsd: 10 }]); // a higher level cannot ask for less
  await bad([{ ...ROW, firstPct: 2 }]); // lower than VIP 0
  await bad([{ ...ROW, firstPct: 8, capPct: 7 }]); // cap below the first reward
  await bad([ROW, { ...ROW, minFriends: 2, dailyPct: 1 }]); // rates cannot drop at a higher level
  await bad([{ ...ROW, friendMinUsd: 99999 }]);
  await bad(Array(16).fill(ROW)); // at most 15 levels
  const { minSpendUsd, ...noSpend } = ROW;
  await bad([noSpend]);
  assert.equal((await referrals.saveSettings({ vip: Array(15).fill({ ...ROW, minFriends: 0 }) })).ok, true); // levels that nobody can reach by friends
  assert.equal(referrals.settings().vip.length, 15);
  assert.equal((await referrals.saveSettings({ vip: [ROW] })).ok, true, 'nobody holds a level, so the table can shrink');
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
  assert.equal((await getUser(email('inv'))).vipSeen, 1, 'the first active friend lifts the inviter');

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

test('a refunded friend does not count toward VIP', async () => {
  assert.equal((await referrals.saveSettings({ vip: [ROW] })).ok, true);
  const view = async () => referrals.vipViewOf(await referrals.getRefCtx(email('inv'))).friends;
  const inviter = (await getUser(email('inv'))).id;
  const count = async () => (await referrals.firstsOf(pool(), inviter)).length;
  assert.equal(await view(), 2);
  assert.equal(await count(), 2);
  const all = (await getUser(email('f2'))).contracts;
  const set = (list) => pool().query("UPDATE users SET data = jsonb_set(data, '{contracts}', $2::jsonb) WHERE id = $1", [email('f2'), JSON.stringify(list)]);
  await set(all.filter((c) => c.bonus)); // refunded: only the gift miner is left
  assert.equal(await view(), 1, 'the refunded friend drops out');
  assert.equal(await count(), 1, 'also in the one-query count');
  await set(all); // back as it was for the next tests
  assert.equal(await view(), 2);
  assert.equal(await count(), 2);
});

test('each level sets its own smallest first purchase for a friend', () => {
  const S = { ...referrals.settings(), vip: [{ ...ROW, friendMinUsd: 50 }, { ...ROW, minSpendUsd: 2000000, friendMinUsd: 100 }] };
  const u = { contracts: [] };
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
  assert.equal((await referrals.saveSettings({ vip: [ROW] })).ok, false, 'VIP 2 is really held: the inviter has enough active friends');
  await pool().query("UPDATE users SET data = jsonb_set(data, '{vipSeen}', '15') WHERE id = $1", [email('inv')]);
  assert.equal((await referrals.saveSettings({ vip: [ROW, { ...ROW, minFriends: 2 }] })).ok, true, 'a stale saved level blocks nothing');
  assert.equal((await referrals.saveSettings({ vip: [ROW, { ...ROW, minFriends: 2 }] })).ok, true);
});

test('a heads-up comes a week before a level drops, once', async () => {
  await referrals.resetSettings(); // the 15 default levels
  const id = email('warn');
  assert.ok((await auth.signup({ email: id, password: PW })).ok);
  const D = 86400000;
  const give = (ago) => pool().query("UPDATE users SET data = jsonb_set(data, '{contracts}', $2::jsonb) WHERE id = $1", [id, JSON.stringify([{ plan: 'Custom', price: 10000, days: 90, startedAt: Date.now() - ago * D }])]);
  const notes = async () => ((await getUser(id)).notifications || []).filter((n) => n.code === 'vipDrop').length;
  await give(40); // the quarter ends in 50 days: too early
  assert.equal(await referrals.warnVipDrop(id), false);
  assert.equal(await notes(), 0);
  await give(85); // ends in 5 days
  assert.equal(await referrals.warnVipDrop(id), true);
  assert.equal(await notes(), 1);
  assert.equal(await referrals.warnVipDrop(id), false, 'only once for this drop');
  assert.equal(await notes(), 1);
});
