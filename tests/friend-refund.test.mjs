// A friend's refund against the inviter's reward and VIP, on a real Postgres: the reward waits for the refund window,
// a refunded first purchase pays nothing and does not count for VIP, even if the friend buys a smaller miner afterwards.
// Each test uses its own accounts, so reruns on the same database are fine.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, withUser, getUser } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');
const miners = await import('@/lib/server/miners');
const { getWallet } = await import('@/lib/server/wallet');
const { firstsOf, getRefCtx, friendReward, DEFAULTS } = await import('@/lib/server/referrals');
const { refundMiner } = await import('@/lib/server/admin');
const { createRequest, decideRefund } = await import('@/lib/server/refund-requests');
const { REASONS } = await import('@/lib/refund-rules');
const { customPlan } = await import('@/lib/data');

const run = `fr${Date.now().toString(36)}`;
const PW = 'correct horse 1';
let seq = 0;

async function account(name, extra = {}) {
  const e = `${name}-${run}@test.dev`;
  assert.ok((await auth.signup({ email: e, password: PW, ...extra })).ok);
  return e;
}
const credit = (id, btc) =>
  withUser(id, (u) => {
    u.withdrawn = (u.withdrawn || 0) - btc;
  });
const availOf = async (id) => {
  const w = await getWallet(id);
  return w.earned - w.withdrawn - w.spent;
};
const empty = async (id) => {
  const left = await availOf(id);
  await withUser(id, (u) => {
    u.withdrawn = (u.withdrawn || 0) + left;
  });
};
async function buy(id) {
  const r = await miners.buyPlan({ planId: 'custom', th: 15, days: 90, pay: 'balance' }, { userId: id, key: `${run}-${++seq}` });
  assert.ok(r.ok, r.error);
  return r.contract.serial;
}
// Inviter and friend, the friend with a paid first miner and no money left over.
async function pair(name) {
  const inv = await account(`${name}-inv`);
  const fr = await account(`${name}-fr`, { ref: (await getUser(inv)).refCode });
  await credit(fr, 0.02);
  const serial = await buy(fr);
  await empty(fr);
  return { inv, fr, serial };
}
// Pretend the friend's refund window has closed: the reward starts a minute ago.
const closeWindow = (fr) =>
  withUser(fr, (u) => {
    u.refRewardAt = Date.now() - 60000;
  });

before(async () => {
  await migrate();
});

after(async () => {
  await pool().end();
});

test('the inviter gets nothing while the friend can still refund', async () => {
  const { inv, fr } = await pair('wait');
  const f = await getUser(fr);
  assert.ok(f.refRewardAt > Date.now(), 'the reward starts after the refund window');
  assert.equal(await availOf(inv), 0);
  assert.equal((await firstsOf(pool(), inv)).length, 0, 'the friend does not count for VIP yet');
});

test('a refunded first purchase pays nothing and the friend never counts for VIP', async () => {
  const { inv, fr, serial } = await pair('void');
  await closeWindow(fr);
  assert.ok((await availOf(inv)) > 0, 'once the window is closed the reward is there');
  assert.equal((await firstsOf(pool(), inv)).length, 1);

  const r = await refundMiner(fr, serial);
  assert.ok(r.ok, r.error);
  assert.equal((await getUser(fr)).refFirstVoid, true);
  assert.equal(await availOf(inv), 0, 'the first-purchase reward is gone');
  assert.equal((await firstsOf(pool(), inv)).length, 0, 'the friend is out of VIP');

  await credit(fr, 0.02);
  await buy(fr); // a new miner after the refund proves nothing
  assert.equal((await firstsOf(pool(), inv)).length, 0, 'buying again does not bring the friend back');
});

const titles = async (id, title) => ((await getUser(id)).notifications || []).filter((n) => n.title === title).length;

test('the inviter is told once when a delayed reward really starts', async () => {
  const { inv, fr } = await pair('note');
  assert.equal(await titles(inv, 'Friend started mining'), 1, 'told at purchase that the reward waits');
  await getRefCtx(inv);
  assert.equal(await titles(inv, 'Reward started'), 0, 'nothing while the window is open');
  await closeWindow(fr);
  await getRefCtx(inv);
  assert.equal(await titles(inv, 'Reward started'), 1);
  await getRefCtx(inv);
  assert.equal(await titles(inv, 'Reward started'), 1, 'only once');
});

test('no start notice when the first purchase was refunded before the reward started', async () => {
  const { inv, fr, serial } = await pair('nonote');
  assert.ok((await refundMiner(fr, serial)).ok);
  await closeWindow(fr);
  await getRefCtx(inv);
  assert.equal(await titles(inv, 'Reward started'), 0);
});

test('after a refunded first purchase the daily share on other miners still counts, the first reward does not', () => {
  const DAY = 86400000;
  const now = Date.now();
  const f = { contracts: [{ price: 100, dailyUsd: 1, days: 90, startedAt: now - 10 * DAY }], refRewardAt: now - 10 * DAY, refFirstUsd: 100, refFirstVoid: true };
  const r = friendReward(f, DEFAULTS, now);
  assert.equal(r.first, 0);
  assert.ok(Math.abs(r.share - 0.1) < 1e-9, `share was ${r.share}`);
  const ok = friendReward({ ...f, refFirstVoid: false }, DEFAULTS, now);
  assert.ok(ok.first > 0, 'without the refund the first reward is there');
});

test('a refund approved after the window closed says so and the request stays open to decline', async () => {
  const { fr, serial } = await pair('late');
  const made = await createRequest(fr, serial, { reason: REASONS[0], note: 'testing refund' });
  assert.ok(made.ok, made.error);
  const later = (userId, s) => refundMiner(userId, s, Date.now() + 3 * 86400000);
  const r = await decideRefund(fr, made.id, 'approve', '', later);
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  assert.match(r.error, /window closed/);
  assert.ok((await getUser(fr)).contracts.some((m) => m.serial === serial), 'the miner is still there');
  const no = await decideRefund(fr, made.id, 'reject', 'Window closed.', later);
  assert.ok(no.ok, no.error);
});
