// The admin Referrals tab lists, a page at a time, against a real Postgres: every friend once, newest first,
// exact counts, and the lists only through the admin-only reader.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, getUser } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');
const miners = await import('@/lib/server/miners');
const referrals = await import('@/lib/server/referrals');
const { adminRefList, overview } = await import('@/lib/server/admin');

const run = `ar${Date.now().toString(36)}`;
const email = (n) => `${n}-${run}@test.dev`;
const PW = 'correct horse 1';
const SMALL = { planId: 'custom', th: 15, days: 90 };

before(async () => {
  await migrate();
});

after(async () => {
  await pool().end();
});

test('friends come a page at a time, newest first, each once, with exact counts', async () => {
  assert.ok((await auth.signup({ email: email('inv'), password: PW })).ok);
  assert.ok((await miners.grantPlan(email('inv'), SMALL)).ok); // a plan lifts the invite limit
  const code = (await getUser(email('inv'))).refCode;
  const names = ['a', 'b', 'c'];
  for (const n of names) {
    assert.equal((await auth.signup({ email: email(n), password: PW, ref: code })).ref, 'applied');
    assert.ok((await miners.grantPlan(email(n), SMALL)).ok);
  }

  const all = await referrals.adminFriendPage({ limit: 200 });
  const ours = all.rows.filter((r) => r.inviter === email('inv'));
  assert.deepEqual(ours.map((r) => r.id), names.map(email).reverse(), 'newest first');
  assert.ok(all.all >= 3 && all.shown === all.all);
  assert.ok(ours.every((r) => r.gift && typeof r.spendUsd === 'number' && typeof r.rewardUsd === 'number'));

  // Paging by offset gives every friend once.
  const seen = [];
  for (let offset = 0; offset < 4; offset += 1) seen.push(...(await referrals.adminFriendPage({ offset, limit: 1 })).rows.map((r) => r.id));
  assert.equal(new Set(seen).size, seen.length);
  assert.equal(seen.length, Math.min(4, all.all));

  // The tab's heading counts match the list.
  assert.equal((await referrals.adminView()).counts.friends, all.all);
  assert.equal((await overview()).referrals.counts.friends, all.all);
  assert.equal('links' in (await overview()).referrals, false, 'the overview carries no friend list');
});

test('free tickets: most first, only inviters who hold some, counted exactly', async () => {
  const t = await referrals.adminTicketPage({ limit: 200 });
  assert.equal(t.shown, t.all);
  assert.ok(t.rows.every((r) => r.n > 0));
  for (let i = 1; i < t.rows.length; i += 1) assert.ok(t.rows[i - 1].n >= t.rows[i].n, 'most tickets first');
  assert.equal((await referrals.adminView()).counts.tickets, t.all);
});

test('the admin reader cuts pages inside the limits and knows only its two lists', async () => {
  assert.ok((await adminRefList('friends', { offset: -5, limit: 100000 })).rows.length <= 200);
  assert.ok((await adminRefList('tickets', {})).rows.length <= 20);
  assert.equal(adminRefList('orders', {}), null);
});
