// A code nobody holds is not found, and migration 003 puts back the rows older accounts were missing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, getUser, defaultCodeOf } = await import('@/lib/server/db');
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

test('a code nobody holds is still not found', async () => {
  assert.equal((await referrals.publicCode('VTX-NOPE')).valid, false);
  assert.equal(await rowOf('VTX-NOPE'), null);
});

test('migration 003 adds the missing rows and leaves existing ones alone', async () => {
  const inv = email('mig');
  assert.ok((await auth.signup({ email: inv, password: PW })).ok);
  const code = (await defaultCodeOf(inv));
  // An older account holds its code in its document; the codes row is what went missing.
  await pool().query("UPDATE users SET data = data || jsonb_build_object('refCode', $2::text) WHERE id = $1", [inv, code]);
  await pool().query('DELETE FROM codes WHERE code = $1', [code]);
  const step = MIGRATIONS.find((m) => m.id === '003_backfill_codes');
  assert.ok(step);
  await pool().query(step.sql);
  assert.equal(await rowOf(code), inv);
  await pool().query(step.sql); // running it again changes nothing
  assert.equal(await rowOf(code), inv);
});
