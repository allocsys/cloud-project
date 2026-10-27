// The admin Database tab against a real Postgres: the overview lists the tables and the applied migrations, a table shows its newest rows
// with JSON cut down to key names and size, an unknown or crafted table name is refused, and nothing can be written.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');
const { databaseOverview, tableRows } = await import('@/lib/server/db-admin');
const { MIGRATIONS } = await import('@/lib/server/migrations');

const run = `d${Date.now().toString(36)}`;

before(async () => {
  await migrate();
});
after(async () => {
  await pool().end();
});

test('the overview lists the tables, the connection figures and the migrations', async () => {
  const o = await databaseOverview();
  assert.equal(o.ok, true, JSON.stringify(o));
  const names = o.tables.map((t) => t.name);
  for (const n of ['users', 'orders', 'withdrawals', 'ledger', 'meta', 'schema_migrations']) assert.ok(names.includes(n), n);
  assert.ok(o.bytes > 0);
  assert.ok(o.connections.total >= 1);
  assert.equal(o.migrations.total, MIGRATIONS.length);
  assert.equal(o.migrations.applied, MIGRATIONS.length);
  assert.deepEqual(o.migrations.pending, []);
  assert.match(o.version, /^PostgreSQL/);
});

test('a table shows its newest rows; JSON shows only its keys and size', async () => {
  const email = `${run}@test.dev`;
  assert.ok((await auth.signup({ email, password: 'correct horse 1' })).ok);
  const r = await tableRows('users');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(r.total >= 1);
  assert.ok(r.rows.length >= 1 && r.rows.length <= 25);
  const mine = r.rows.find((x) => x.id === email);
  assert.ok(mine, 'the newest account is listed');
  assert.match(mine.data, / B$/, 'size shown');
  assert.ok(!mine.data.includes('{'), 'no JSON body');
});

test('the saved session key and settings are never shown', async () => {
  const r = await tableRows('meta');
  assert.equal(r.ok, true);
  const key = r.rows.find((x) => x.key === 'authkey');
  assert.ok(key);
  assert.match(key.data, /^string · \d+ B$/);
});

test('an unknown or crafted table name is refused', async () => {
  for (const name of ['nope', 'users"; DROP TABLE users; --', 'pg_catalog.pg_user', '', undefined, null, 5]) {
    const r = await tableRows(name);
    assert.equal(r.ok, false, String(name));
  }
  const still = await tableRows('users');
  assert.equal(still.ok, true);
});
