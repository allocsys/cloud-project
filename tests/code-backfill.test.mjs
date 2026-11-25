// A code nobody holds is not found.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const referrals = await import('@/lib/server/referrals');

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
