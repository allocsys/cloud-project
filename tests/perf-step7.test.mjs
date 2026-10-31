// Step 7 performance changes: the referral context loads slim friend documents, and the winners bar has its own index.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, q, getUser, friendsOf } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');
const miners = await import('@/lib/server/miners');
const { getRefCtx, summaryOf, historyOfCtx } = await import('@/lib/server/referrals');

const run = `p${Date.now().toString(36)}`;
const email = (n) => `${n}-${run}@test.dev`;
const PW = 'correct horse 1';
const SMALL = { planId: 'custom', th: 15, days: 90 };

before(async () => {
  await migrate();
});

after(async () => {
  await pool().end();
});

test('slim friend load gives the same referral numbers as full accounts', async () => {
  const inviter = email('inv');
  assert.ok((await auth.signup({ email: inviter, password: PW })).ok);
  assert.ok((await miners.grantPlan(inviter, SMALL)).ok);
  const code = (await getUser(inviter)).refCode;
  const friends = [email('f1'), email('f2'), email('f3')];
  for (const f of friends) assert.equal((await auth.signup({ email: f, password: PW, ref: code })).ref, 'applied');
  // Two friends buy (rewarded), one stays pending.
  assert.ok((await miners.grantPlan(friends[0], SMALL)).ok);
  assert.ok((await miners.grantPlan(friends[1], SMALL)).ok);

  const ctx = await getRefCtx(inviter);
  assert.equal(ctx.friends.length, 3);
  const full = await Promise.all(ctx.friends.map((f) => getUser(f.id)));
  const ctxFull = { ...ctx, friends: full };

  const a = summaryOf(ctx);
  const b = summaryOf(ctxFull);
  assert.ok(a.earnedUsd > 0, 'the friends earned something');
  assert.deepEqual(a, b);
  const now = Date.now();
  assert.deepEqual(historyOfCtx(ctx, now), historyOfCtx(ctxFull, now));

  // The slim copies leave out the heavy parts but keep the miners.
  const slim = JSON.stringify(ctx.friends);
  assert.ok(slim.length < JSON.stringify(full).length, 'slim friends are smaller');
  for (const s of ctx.friends) {
    assert.equal(s.notifications.length, 0);
    assert.equal(s.history.length, 0);
    assert.deepEqual(s.contracts, full.find((x) => x.id === s.id).contracts);
  }
  assert.ok(full.some((x) => x.notifications.length > 0), 'full accounts do have notifications');
});

test('friendsOf returns only the inviter\'s friends, newest first', async () => {
  const inviter = email('inv2');
  assert.ok((await auth.signup({ email: inviter, password: PW })).ok);
  const code = (await getUser(inviter)).refCode;
  const f1 = email('g1');
  const f2 = email('g2');
  assert.equal((await auth.signup({ email: f1, password: PW, ref: code })).ref, 'applied');
  assert.equal((await auth.signup({ email: f2, password: PW, ref: code })).ref, 'applied');
  const list = await friendsOf(inviter);
  assert.deepEqual(list.map((f) => f.id), [f2, f1]);
  assert.ok(list.every((f) => f.refUsed && f.refAt));
});

test('the winning-boost index exists', async () => {
  const r = await q("SELECT 1 FROM pg_indexes WHERE indexname = 'users_boost_win_idx'");
  assert.equal(r.rowCount, 1);
});
