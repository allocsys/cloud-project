// The codes table also holds each code's name, rebate, default flag and created time: written when a code is made or raised.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, defaultCodeOf, codesOfUsers } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
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
