// An account that holds an invite code in its document but has no row in codes (older accounts) must still be found at sign-up,
// and migration 003 puts the missing rows back.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, getUser } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const { MIGRATIONS } = await import('@/lib/server/migrations');
const auth = await import('@/lib/server/auth');
const referrals = await import('@/lib/server/referrals');

const run = `cb${Date.now().toString(36)}`;
const email = (n) => `${n}-${run}@test.dev`;
const PW = 'correct horse 1';
const rowOf = async (code) => (await pool().query('SELECT user_id FROM codes WHERE code = $1', [code.toUpperCase()])).rows[0]?.user_id || null;

before(async () => {
  await migrate();
});

after(async () => {
  await pool().end();
});

test('a code with no codes row is still found, and the row is put back', async () => {
  const inv = email('inv');
  assert.ok((await auth.signup({ email: inv, password: PW })).ok);
  const code = (await getUser(inv)).refCode;
  await pool().query('DELETE FROM codes WHERE code = $1', [code]);
  assert.equal(await rowOf(code), null);

  assert.equal((await referrals.publicCode(code.toLowerCase())).valid, true);
  assert.equal(await rowOf(code), inv, 'the row is back');
  assert.equal((await auth.signup({ email: email('fr'), password: PW, ref: code })).ref, 'applied');
});

test('a code nobody holds is still not found', async () => {
  assert.equal((await referrals.publicCode('VTX-NOPE')).valid, false);
  assert.equal(await rowOf('VTX-NOPE'), null);
});

test('migration 003 adds the missing rows and leaves existing ones alone', async () => {
  const inv = email('mig');
  assert.ok((await auth.signup({ email: inv, password: PW })).ok);
  const code = (await getUser(inv)).refCode;
  await pool().query('DELETE FROM codes WHERE code = $1', [code]);
  const step = MIGRATIONS.find((m) => m.id === '003_backfill_codes');
  assert.ok(step);
  await pool().query(step.sql);
  assert.equal(await rowOf(code), inv);
  await pool().query(step.sql); // running it again changes nothing
  assert.equal(await rowOf(code), inv);
});
