// The codes table also holds each code's name, rebate, default flag and created time (migration 004): written when a code is made or
// raised, and filled from the account documents by the migration.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, defaultCodeOf, codesOfUsers } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const { MIGRATIONS } = await import('@/lib/server/migrations');
const auth = await import('@/lib/server/auth');
const referrals = await import('@/lib/server/referrals');

const run = `cc${Date.now().toString(36)}`;
const email = (n) => `${n}-${run}@test.dev`;
const PW = 'correct horse 1';
const rowOf = async (code) => (await pool().query('SELECT user_id, name, rebate, is_default, created_at FROM codes WHERE code = $1', [code.toUpperCase()])).rows[0] || null;

before(async () => {
  await migrate();
});

after(async () => {
  await pool().end();
});

test('a new account saves its default code with name, rebate 0, default flag and time', async () => {
  const id = email('def');
  assert.ok((await auth.signup({ email: id, password: PW })).ok);
  const row = await rowOf((await defaultCodeOf(id)));
  assert.equal(row.user_id, id);
  assert.deepEqual([row.name, row.rebate, row.is_default], ['Default', 0, true]);
  assert.ok(Number(row.created_at) > 0);
});

test('a named code saves its name and rebate, and raising it changes the table too', async () => {
  const id = email('named');
  assert.ok((await auth.signup({ email: id, password: PW })).ok);
  assert.ok((await referrals.createCode(id, { name: 'Friends', rebate: 2 })).ok);
  const code = (await codesOfUsers([id])).get(id).find((k) => !k.default).code;
  let row = await rowOf(code);
  assert.deepEqual([row.name, row.rebate, row.is_default], ['Friends', 2, false]);
  assert.ok((await referrals.raiseCode(id, code, 3)).ok);
  row = await rowOf(code);
  assert.equal(row.rebate, 3);
  assert.equal((await codesOfUsers([id])).get(id).find((k) => k.code === code).rebate, 3);
});

test('migration 004 fills the columns from an older account document and can run again', async () => {
  const id = email('mig');
  assert.ok((await auth.signup({ email: id, password: PW })).ok);
  assert.ok((await referrals.createCode(id, { name: 'Group', rebate: 1 })).ok);
  const def = await defaultCodeOf(id);
  const named = (await codesOfUsers([id])).get(id).find((k) => !k.default).code;
  // An account made before codes moved to the table holds them in its document.
  await pool().query("UPDATE users SET data = data || jsonb_build_object('refCode', $2::text, 'refCodes', jsonb_build_array(jsonb_build_object('code', $3::text, 'name', 'Group', 'rebate', 1, 'at', 5))) WHERE id = $1", [id, def, named]);
  await pool().query("UPDATE codes SET name = NULL, rebate = 0, is_default = false, created_at = NULL WHERE user_id = $1", [id]);
  const step = MIGRATIONS.find((m) => m.id === '004_codes_columns');
  assert.ok(step);
  await pool().query(step.sql);
  await pool().query(step.sql);
  const d = await rowOf(def);
  const n = await rowOf(named);
  assert.deepEqual([d.name, d.rebate, d.is_default], ['Default', 0, true]);
  assert.deepEqual([n.name, n.rebate, n.is_default], ['Group', 1, false]);
  assert.ok(Number(d.created_at) > 0 && Number(n.created_at) > 0);
});
