// The admin Withdrawals list a page at a time, against a real Postgres: exact counts, the Open filter never hides an open row,
// open rows come first, and paging by offset gives every row once. Rows of other tests may be in the table, so only our own are checked.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, q } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');
const { adminList, LIST_PAGE, LIST_MAX } = await import('@/lib/server/admin');

const run = `l${Date.now().toString(36)}`;
const mine = (id) => id.startsWith(`wd_${run}_`);

before(async () => {
  await migrate();
});

after(async () => {
  await pool().end();
});

test('withdrawals come a page at a time with exact counts, and open ones are never cut off', async () => {
  const email = `lists-${run}@test.dev`;
  assert.ok((await auth.signup({ email, password: 'correct horse 1' })).ok);
  const before = await adminList('withdrawals', { filter: 'all' });
  // 25 old open rows (older than everything else) and 8 newer finished ones.
  const t0 = Date.now() - 1000 * 3600 * 24 * 400;
  for (let i = 0; i < 25; i += 1) {
    const id = `wd_${run}_o${String(i).padStart(2, '0')}`;
    await q('INSERT INTO withdrawals (id, user_id, status, at, data, idem_key) VALUES ($1, $2, $3, $4, $5::jsonb, NULL)', [id, email, i % 2 ? 'approved' : 'pending', t0 + i, JSON.stringify({ id, asset: 'btc', net: 'btc', address: 'bc1qtest', amount: '0.001', receive: '0.001', btc: 0.001 })]);
  }
  for (let i = 0; i < 8; i += 1) {
    const id = `wd_${run}_s${i}`;
    await q('INSERT INTO withdrawals (id, user_id, status, at, data, idem_key) VALUES ($1, $2, $3, $4, $5::jsonb, NULL)', [id, email, 'sent', Date.now() + i, JSON.stringify({ id, asset: 'btc', net: 'btc', address: 'bc1qtest', amount: '0.001', receive: '0.001', btc: 0.001 })]);
  }

  // Open filter: exact counts, a page is LIST_PAGE long by default, and every one of ours that is open can be reached.
  const first = await adminList('withdrawals', { filter: 'open' });
  assert.equal(first.rows.length, Math.min(LIST_PAGE, first.shown));
  assert.equal(first.open, before.open + 25);
  assert.equal(first.all, before.all + 33);
  assert.equal(first.shown, first.open);
  assert.ok(first.rows.every((r) => r.status === 'pending' || r.status === 'approved'));
  const seen = new Set();
  for (let offset = 0; offset < first.shown; offset += LIST_PAGE) {
    for (const r of (await adminList('withdrawals', { filter: 'open', offset, limit: LIST_PAGE })).rows) {
      assert.equal(seen.has(r.id), false, 'a row comes once');
      seen.add(r.id);
    }
  }
  assert.equal(seen.size, first.shown);
  assert.equal([...seen].filter(mine).length, 25, 'every open row of ours is reachable, even the oldest');

  // All filter: open rows first, then the rest, and the size is the whole table.
  const all = await adminList('withdrawals', { filter: 'all', limit: LIST_MAX });
  assert.equal(all.shown, all.all);
  const firstDone = all.rows.findIndex((r) => r.status !== 'pending' && r.status !== 'approved');
  if (firstDone >= 0) assert.ok(all.rows.slice(firstDone).every((r) => r.status !== 'pending' && r.status !== 'approved'), 'no open row after a finished one');

  // Bad input is kept inside the limits.
  assert.equal((await adminList('withdrawals', { offset: -5, limit: 100000 })).rows.length <= LIST_MAX, true);
  assert.equal((await adminList('withdrawals', { limit: 0 })).rows.length <= LIST_PAGE, true);
  assert.equal(adminList('nope'), null);
});
