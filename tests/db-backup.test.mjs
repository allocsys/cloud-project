// The admin backup against a real Postgres: the file lists every table, a restore brings back exactly what the backup held (long numbers
// included), a crafted or damaged file is refused, and a restore that fails halfway changes nothing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';

const { pool, userExists } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');
const { makeBackup, inspectBackup, restoreBackup } = await import('@/lib/server/db-backup');

const run = `b${Date.now().toString(36)}`;
const DAY = '900000000000001';

const unpack = (buf) => {
  const lines = zlib.gunzipSync(buf).toString('utf8').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
};
const pack = (lines) => zlib.gzipSync(Buffer.from(`${lines.join('\n')}\n`));

before(async () => {
  await migrate();
});
after(async () => {
  await pool().query('DELETE FROM market_days WHERE day = $1', [DAY]);
  await pool().query('DELETE FROM ledger WHERE ref = $1', [run]);
  await pool().end();
});

test('the backup lists every table except the migrations table, and every row is in the file', async () => {
  const b = await makeBackup();
  assert.equal(b.ok, true, JSON.stringify(b));
  const lines = unpack(b.buf);
  const head = JSON.parse(lines[0]);
  assert.equal(head.format, 'vtx-backup');
  const names = head.tables.map((t) => t.name);
  for (const n of ['users', 'orders', 'withdrawals', 'ledger', 'meta', 'smart_coins']) assert.ok(names.includes(n), n);
  assert.ok(!names.includes('schema_migrations'));
  assert.ok(head.sequences.serial_seq);
  assert.equal(lines.length - 1, head.tables.reduce((a, t) => a + t.rows, 0));
});

test('a restore brings back the backup exactly, long numbers included, and drops what came after', async () => {
  const a = `${run}a@test.dev`;
  const later = `${run}b@test.dev`;
  assert.ok((await auth.signup({ email: a, password: 'correct horse 1' })).ok);
  await pool().query("INSERT INTO ledger (user_id, kind, btc, usd, ref) VALUES ($1, 'payment', '0.12345678', '12.34', $2)", [a, run]);
  await pool().query('INSERT INTO market_days (day, btc_usd, difficulty, gross_per_th, at) VALUES ($1, 84800.12, $2, 0.00000123, 1)', [DAY, '123456789012345678901234']);
  const seqBefore = (await pool().query('SELECT last_value::text AS v, is_called FROM serial_seq')).rows[0];
  const b = await makeBackup();
  assert.equal(b.ok, true);

  assert.ok((await auth.signup({ email: later, password: 'correct horse 1' })).ok);
  await pool().query("SELECT nextval('serial_seq')");
  assert.equal(await userExists(later), true);

  const info = await inspectBackup(b.buf);
  assert.equal(info.ok, true, JSON.stringify(info));
  assert.ok(info.rows > 0 && info.now > 0);
  assert.equal(info.tables.find((t) => t.name === 'users').rows + 1, info.tables.find((t) => t.name === 'users').now);

  const r = await restoreBackup(b.buf, 'RESTORE');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(await userExists(a), true, 'the account from the backup is back');
  assert.equal(await userExists(later), false, 'the account made after the backup is gone');
  const m = (await pool().query('SELECT difficulty::text AS d FROM market_days WHERE day = $1', [DAY])).rows[0];
  assert.equal(m.d, '123456789012345678901234');
  const l = (await pool().query('SELECT btc::text AS b, usd::text AS u FROM ledger WHERE ref = $1', [run])).rows[0];
  assert.deepEqual(l, { b: '0.12345678', u: '12.34' });
  const seqAfter = (await pool().query('SELECT last_value::text AS v, is_called FROM serial_seq')).rows[0];
  assert.deepEqual(seqAfter, seqBefore);
});

test('a restore needs the word RESTORE and changes nothing without it', async () => {
  const b = await makeBackup();
  const email = `${run}c@test.dev`;
  assert.ok((await auth.signup({ email, password: 'correct horse 1' })).ok);
  for (const word of [undefined, null, '', 'restore', 'yes']) {
    const r = await restoreBackup(b.buf, word);
    assert.equal(r.ok, false, String(word));
  }
  assert.equal(await userExists(email), true);
});

test('a file that is not a backup, is damaged, or comes from other migrations is refused', async () => {
  const b = await makeBackup();
  const lines = unpack(b.buf);
  const head = JSON.parse(lines[0]);

  const bad = [
    Buffer.alloc(0),
    Buffer.from('hello'),
    zlib.gzipSync(Buffer.from('not json\n')),
    zlib.gzipSync(Buffer.from(`${JSON.stringify({ format: 'other', version: 1 })}\n`)),
    pack([lines[0], ...lines.slice(2)]), // a row is missing: the count no longer fits
    pack([JSON.stringify({ ...head, schema: ['999_other'] }), ...lines.slice(1)]),
    pack([JSON.stringify({ ...head, tables: [...head.tables, { name: 'nope', rows: 0 }] }), ...lines.slice(1)]),
    pack([JSON.stringify({ ...head, version: 2 }), ...lines.slice(1)]),
  ];
  for (const buf of bad) {
    const i = await inspectBackup(buf);
    assert.equal(i.ok, false);
    assert.equal((await restoreBackup(buf, 'RESTORE')).ok, false);
  }
  assert.equal((await inspectBackup(b.buf)).ok, true, 'the real file is still fine');
});

test('a restore that fails halfway changes nothing', async () => {
  const keep = `${run}d@test.dev`;
  assert.ok((await auth.signup({ email: keep, password: 'correct horse 1' })).ok);
  const b = await makeBackup();
  const lines = unpack(b.buf);
  const head = JSON.parse(lines[0]);
  let pos = 1;
  for (const t of head.tables) {
    if (t.name === 'users') {
      lines.splice(pos, 0, lines[pos]); // the same account twice: the insert breaks
      t.rows += 1;
      break;
    }
    pos += t.rows;
  }
  lines[0] = JSON.stringify(head);
  const before = (await pool().query('SELECT count(*)::int AS n FROM users')).rows[0].n;
  const r = await restoreBackup(pack(lines), 'RESTORE');
  assert.equal(r.ok, false);
  assert.equal((await pool().query('SELECT count(*)::int AS n FROM users')).rows[0].n, before);
  assert.equal(await userExists(keep), true);
});
