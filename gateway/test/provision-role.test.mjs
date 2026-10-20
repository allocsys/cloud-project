import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { ensureDatabase } from '../src/ensure-db.js';
import { provisionRole } from '../src/provision-role.js';

const BASE = process.env.DATABASE_URL;
const tag = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const PW1 = 'p1_' + 'a1b2c3d4'.repeat(3);
const PW2 = 'p2_' + 'e5f6a7b8'.repeat(3);

async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function cleanup({ db, role, probe }) {
  await withClient(BASE, async (c) => {
    if (probe) await c.query(`DROP TABLE IF EXISTS "${probe}"`);
    if (db) await c.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    if (role) await c.query(`DROP ROLE IF EXISTS "${role}"`);
  });
}

test('provisionRole: the limited login owns the gateway database and can run migrations', { skip: !BASE }, async () => {
  const db = `gw_r_${tag()}`;
  const role = `gw_role_${tag()}`;
  try {
    const adminUrl = await ensureDatabase(BASE, db);
    // objects created by the admin login first (like the first boot), including a serial table and a function
    await withClient(adminUrl, async (c) => {
      await c.query('CREATE TABLE old_t (id serial PRIMARY KEY, v text)');
      await c.query("INSERT INTO old_t (v) VALUES ('before')");
      await c.query('CREATE FUNCTION old_fn() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$');
    });

    const url = await provisionRole(BASE, { db, role, password: PW1 });
    assert.equal(decodeURIComponent(new URL(url).username), role);
    assert.equal(new URL(url).pathname, `/${db}`);

    await withClient(url, async (c) => {
      assert.equal((await c.query('SELECT current_user AS u')).rows[0].u, role);
      // old objects usable, including the serial counter
      await c.query("INSERT INTO old_t (v) VALUES ('after')");
      assert.equal((await c.query('SELECT count(*)::int AS n FROM old_t')).rows[0].n, 2);
      // later migrations can create and alter things
      await c.query('CREATE TABLE new_t (id int)');
      await c.query('ALTER TABLE old_t ADD COLUMN extra int');
      await c.query('ALTER FUNCTION old_fn() RENAME TO old_fn2');
      // no power over the server
      await assert.rejects(() => c.query('CREATE DATABASE nope_' + tag().replace(/-/g, '_')), /permission denied/);
      await assert.rejects(() => c.query('CREATE ROLE nope_' + tag()), /permission denied/);
    });
  } finally {
    await cleanup({ db, role });
  }
});

test('provisionRole: no access to tables in other databases', { skip: !BASE }, async () => {
  const db = `gw_r_${tag()}`;
  const role = `gw_role_${tag()}`;
  const probe = `gw_probe_${tag()}`;
  try {
    await ensureDatabase(BASE, db);
    await withClient(BASE, async (c) => {
      await c.query(`CREATE TABLE "${probe}" (secret text)`);
      await c.query(`INSERT INTO "${probe}" VALUES ('app data')`);
    });
    const url = await provisionRole(BASE, { db, role, password: PW1 });
    // same server, base database: the login may connect, but must not read the app's tables
    const baseAsRole = new URL(BASE);
    baseAsRole.username = role;
    baseAsRole.password = PW1;
    await withClient(baseAsRole.toString(), async (c) => {
      await assert.rejects(() => c.query(`SELECT * FROM "${probe}"`), /permission denied/);
    });
    assert.ok(url);
  } finally {
    await cleanup({ db, role, probe });
  }
});

test('provisionRole: repeat call resets the password; the old one stops working; other logins cannot connect to the gateway db', { skip: !BASE }, async () => {
  const db = `gw_r_${tag()}`;
  const role = `gw_role_${tag()}`;
  const other = `gw_other_${tag()}`;
  try {
    await ensureDatabase(BASE, db);
    const url1 = await provisionRole(BASE, { db, role, password: PW1 });
    const url2 = await provisionRole(BASE, { db, role, password: PW2 });
    await withClient(url2, (c) => c.query('SELECT 1'));
    await assert.rejects(() => withClient(url1, (c) => c.query('SELECT 1')), /password authentication failed/);

    // a different limited login is shut out of the gateway database
    await withClient(BASE, (c) => c.query(`CREATE ROLE "${other}" LOGIN PASSWORD '${PW1}'`));
    const asOther = new URL(BASE);
    asOther.username = other;
    asOther.password = PW1;
    asOther.pathname = `/${db}`;
    await assert.rejects(() => withClient(asOther.toString(), (c) => c.query('SELECT 1')), /permission denied/);
  } finally {
    await cleanup({ db, role });
    await withClient(BASE, (c) => c.query(`DROP ROLE IF EXISTS "${other}"`));
  }
});

test('provisionRole: refuses bad names, short passwords, admin logins and bad URLs, without echoing secrets', async () => {
  const ok = { db: 'gw_ok', role: 'gw_limited', password: PW1 };
  const url = 'postgres://postgres:adminpw-secret@localhost:5432/x';
  await assert.rejects(() => provisionRole(url, { ...ok, db: 'Bad-Name' }), /not a valid database name/);
  await assert.rejects(() => provisionRole(url, { ...ok, role: 'Bad Role' }), /GATEWAY_DB_USER must be/);
  await assert.rejects(() => provisionRole(url, { ...ok, role: undefined }), /GATEWAY_DB_USER must be/);
  await assert.rejects(() => provisionRole(url, { ...ok, role: 'postgres' }), /built-in or admin/);
  await assert.rejects(() => provisionRole(url, { ...ok, role: 'pg_monitor' }), /built-in or admin/);
  await assert.rejects(() => provisionRole(url, { ...ok, password: 'short' }), /at least 16/);
  await assert.rejects(() => provisionRole(url, { ...ok, password: undefined }), /at least 16/);
  await assert.rejects(
    () => provisionRole('postgres://gw_limited:adminpw-secret@localhost:5432/x', ok),
    (e) => /already/.test(e.message) && !e.message.includes('adminpw-secret'),
  );
  await assert.rejects(
    () => provisionRole('not a url adminpw-secret', ok),
    (e) => /not a valid URL/.test(e.message) && !e.message.includes('adminpw-secret'),
  );
});
