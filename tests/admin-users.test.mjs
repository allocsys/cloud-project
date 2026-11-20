// The admin Users list a page at a time, against a real Postgres: search, filter and order are applied over every account,
// paging gives each account once, rows carry no activity rows, and the history comes from its own read.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');
const { adminUsers, adminUserHistory, overview, act, USERS_PAGE } = await import('@/lib/server/admin');

const run = `u${Date.now().toString(36)}`;
const mail = (n) => `users-${run}-${n}@test.dev`;

before(async () => {
  await migrate();
});

after(async () => {
  await pool().end();
});

test('users come a page at a time, with search, filter and order done on the server', async () => {
  for (let i = 0; i < 5; i += 1) assert.ok((await auth.signup({ email: mail(i), password: 'correct horse 1' })).ok);
  assert.ok((await act({ action: 'user', userId: mail(2), op: 'block' })).ok);

  // Search: only ours, the newest first, and the whole count is reported.
  const found = await adminUsers({ q: run, limit: 200 });
  assert.equal(found.shown, 5);
  assert.deepEqual(found.rows.map((r) => r.id).sort(), [0, 1, 2, 3, 4].map(mail).sort());
  assert.ok(found.all >= 5);
  assert.ok(found.rows.every((r) => !('history' in r) && typeof r.historyN === 'number'), 'rows carry no activity rows');
  for (let i = 1; i < found.rows.length; i += 1) assert.ok((found.rows[i - 1].joined || 0) >= (found.rows[i].joined || 0), 'newest first');

  // Paging by offset gives every account once.
  const seen = [];
  for (let offset = 0; offset < 10; offset += 2) seen.push(...(await adminUsers({ q: run, offset, limit: 2 })).rows.map((r) => r.id));
  assert.equal(new Set(seen).size, 5);
  assert.equal(seen.length, 5);

  // Filter: the blocked one, and the Blocked filter never shows an account that is not blocked.
  const blocked = await adminUsers({ q: run, filter: 'blocked' });
  assert.deepEqual(blocked.rows.map((r) => r.id), [mail(2)]);
  assert.equal(blocked.shown, 1);

  // Bad input stays inside the limits, and the default page is USERS_PAGE long at most.
  assert.ok((await adminUsers({ offset: -5, limit: 100000, filter: 'nope', sort: 'nope' })).rows.length <= 200);
  assert.ok((await adminUsers({})).rows.length <= USERS_PAGE);
});

test('the history is read on its own, and the overview carries no account list', async () => {
  const h = await adminUserHistory(mail(0));
  assert.ok(Array.isArray(h));
  assert.equal(await adminUserHistory('nobody-here@test.dev'), null);
  const o = await overview();
  assert.equal('users' in o, false);
  assert.ok(o.hallStat && typeof o.hallStat === 'object');
  assert.ok(Array.isArray(o.rated));
  assert.ok((await overview({ withUsers: true })).users.some((u) => u.id === mail(0)));
});
