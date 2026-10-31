// The admin Database tab against a real Postgres: the overview lists the tables and the applied migrations, a table shows its newest rows
// with JSON cut down to key names and size, an unknown or crafted table name is refused, and the only changes possible are the narrow
// ones: remove one row by its key, clear a table (name typed), drop a table the app does not use (name typed).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');
const { databaseOverview, tableRows, deleteRow, clearTable, dropTable, CORE_TABLES } = await import('@/lib/server/db-admin');
const { MIGRATIONS } = await import('@/lib/server/migrations');

const run = `d${Date.now().toString(36)}`;
const q = (sql, p) => pool().query(sql, p);

before(async () => {
  await migrate();
});
after(async () => {
  await q(`DROP TABLE IF EXISTS "x_${run}", "np_${run}"`).catch(() => {});
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
  assert.ok(!('__k0' in mine), 'the key helper column is not shown');
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
    assert.equal((await deleteRow(name, { id: 'a' })).ok, false, `row ${String(name)}`);
    assert.equal((await clearTable(name, name)).ok, false, `clear ${String(name)}`);
    assert.equal((await dropTable(name, name)).ok, false, `drop ${String(name)}`);
  }
  const still = await tableRows('users');
  assert.equal(still.ok, true);
});

test('one row can be removed by its key; a wrong or crafted key removes nothing', async () => {
  const t = `x_${run}`;
  await q(`CREATE TABLE "${t}" (id text PRIMARY KEY, v text)`);
  await q(`INSERT INTO "${t}" VALUES ('a', '1'), ('b', '2'), ('c', '3')`);
  const r = await tableRows(t);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.canDelete, true);
  assert.deepEqual(r.keyCols, ['id']);
  assert.equal(r.keys.length, 3);
  assert.equal(r.core, false);
  const o = await databaseOverview();
  assert.equal(o.tables.find((x) => x.name === t).core, false);
  assert.equal(o.tables.find((x) => x.name === 'users').core, true);

  for (const key of [{ id: "a' OR '1'='1" }, { id: 5 }, {}, null, 'a']) {
    assert.equal((await deleteRow(t, key)).ok, false, JSON.stringify(key));
  }
  assert.equal((await tableRows(t)).total, 3, 'nothing removed yet');

  const key = r.keys[r.rows.findIndex((x) => x.id === 'b')];
  const d = await deleteRow(t, key);
  assert.equal(d.ok, true, JSON.stringify(d));
  assert.equal(d.removed, 1);
  const after1 = await tableRows(t);
  assert.equal(after1.total, 2);
  assert.deepEqual(after1.rows.map((x) => x.id).sort(), ['a', 'c']);
  assert.equal((await deleteRow(t, key)).ok, false, 'already gone');
});

test('a table is cleared only when its name is typed, then dropped the same way', async () => {
  const t = `x_${run}`;
  assert.equal((await clearTable(t, 'wrong')).ok, false);
  assert.equal((await clearTable(t, undefined)).ok, false);
  assert.equal((await tableRows(t)).total, 2);
  const c = await clearTable(t, t);
  assert.equal(c.ok, true, JSON.stringify(c));
  assert.equal(c.removed, 2);
  assert.equal((await tableRows(t)).total, 0);

  assert.equal((await dropTable(t, 'wrong')).ok, false);
  assert.equal((await tableRows(t)).ok, true, 'still there');
  const d = await dropTable(t, t);
  assert.equal(d.ok, true, JSON.stringify(d));
  assert.equal((await tableRows(t)).ok, false, 'gone');
});

test('a table without a primary key can only be cleared, not row by row', async () => {
  const t = `np_${run}`;
  await q(`CREATE TABLE "${t}" (v text)`);
  await q(`INSERT INTO "${t}" VALUES ('1'), ('2')`);
  const r = await tableRows(t);
  assert.equal(r.canDelete, false);
  assert.deepEqual(r.keyCols, []);
  assert.equal((await deleteRow(t, {})).ok, false);
  assert.equal((await tableRows(t)).total, 2);
  assert.equal((await clearTable(t, t)).ok, true);
  assert.equal((await dropTable(t, t)).ok, true);
});

test('the app tables cannot be dropped and the migration record cannot be touched', async () => {
  for (const n of CORE_TABLES) {
    const r = await dropTable(n, n);
    assert.equal(r.ok, false, `drop ${n}`);
  }
  assert.equal((await deleteRow('schema_migrations', { id: MIGRATIONS[0].id })).ok, false);
  assert.equal((await clearTable('schema_migrations', 'schema_migrations')).ok, false);
  const sm = await tableRows('schema_migrations');
  assert.equal(sm.locked, true);
  assert.equal(sm.canDelete, false);
  const o = await databaseOverview();
  assert.equal(o.ok, true);
  assert.equal(o.migrations.applied, MIGRATIONS.length);
  assert.ok(o.tables.some((x) => x.name === 'users'));
});

test('changes are written to the admin log', async () => {
  const t = `x_${run}`;
  await q(`CREATE TABLE "${t}" (id text PRIMARY KEY)`);
  assert.equal((await dropTable(t, t)).ok, true);
  const log = (await q("SELECT data FROM meta WHERE key = 'adminlog'")).rows[0]?.data || [];
  assert.ok(log.some((e) => e.action === 'db-drop' && e.subject === t));
});
