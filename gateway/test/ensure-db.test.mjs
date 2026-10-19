import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { ensureDatabase } from '../src/ensure-db.js';

const BASE = process.env.DATABASE_URL;
const unique = () => `gw_t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

async function dropDatabase(name) {
  const c = new pg.Client({ connectionString: BASE });
  await c.connect();
  try {
    await c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    await c.end();
  }
}

async function currentDatabase(url) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return (await c.query('SELECT current_database() AS d')).rows[0].d;
  } finally {
    await c.end();
  }
}

test('ensureDatabase: creates a separate database and returns its URL', { skip: !BASE }, async () => {
  const name = unique();
  try {
    const url = await ensureDatabase(BASE, name);
    assert.equal(new URL(url).pathname, `/${name}`);
    assert.equal(await currentDatabase(url), name);
    // credentials and host stay the same as the base URL
    assert.equal(new URL(url).host, new URL(BASE).host);
    assert.equal(new URL(url).username, new URL(BASE).username);
  } finally {
    await dropDatabase(name);
  }
});

test('ensureDatabase: second call is a no-op and keeps the data', { skip: !BASE }, async () => {
  const name = unique();
  try {
    const url = await ensureDatabase(BASE, name);
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    await c.query('CREATE TABLE keep_me (id int)');
    await c.query('INSERT INTO keep_me VALUES (1)');
    await c.end();

    const again = await ensureDatabase(BASE, name);
    assert.equal(again, url);
    const c2 = new pg.Client({ connectionString: again });
    await c2.connect();
    const r = await c2.query('SELECT count(*)::int AS n FROM keep_me');
    await c2.end();
    assert.equal(r.rows[0].n, 1);
  } finally {
    await dropDatabase(name);
  }
});

test('ensureDatabase: several processes at once all succeed', { skip: !BASE }, async () => {
  const name = unique();
  try {
    const urls = await Promise.all([1, 2, 3, 4].map(() => ensureDatabase(BASE, name)));
    for (const u of urls) assert.equal(new URL(u).pathname, `/${name}`);
    assert.equal(await currentDatabase(urls[0]), name);
  } finally {
    await dropDatabase(name);
  }
});

test('ensureDatabase: refuses unsafe or invalid names', async () => {
  for (const bad of ['', 'Bad', 'has-dash', '1abc', 'x"; DROP DATABASE y; --', 'a'.repeat(64), undefined, null]) {
    await assert.rejects(() => ensureDatabase('postgres://u:p@localhost:5432/x', bad), /GATEWAY_DB_NAME must be/);
  }
});

test('ensureDatabase: refuses the database the URL already points at', { skip: !BASE }, async () => {
  const current = decodeURIComponent(new URL(BASE).pathname.slice(1));
  await assert.rejects(() => ensureDatabase(BASE, current), /already points at/);
});

test('ensureDatabase: a bad URL is rejected without echoing it', async () => {
  await assert.rejects(
    () => ensureDatabase('not a url with secret-pw', 'gw_ok'),
    (e) => /not a valid URL/.test(e.message) && !e.message.includes('secret-pw'),
  );
});
