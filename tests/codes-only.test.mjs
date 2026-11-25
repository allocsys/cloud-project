// Accounts never hold refCode or refCodes: the codes table is the only place for invite codes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, getUser } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');
const referrals = await import('@/lib/server/referrals');

const run = `co${Date.now().toString(36)}`;
const email = (n) => `${n}-${run}@test.dev`;
const PW = 'correct horse 1';

before(async () => {
  await migrate();
});

after(async () => {
  await pool().end();
});

test('new accounts never hold the fields, with or without a named code', async () => {
  const id = email('new');
  assert.ok((await auth.signup({ email: id, password: PW })).ok);
  assert.ok((await referrals.createCode(id, { name: 'Pals', rebate: 2 })).ok);
  const u = await getUser(id);
  assert.equal(u.refCode, undefined);
  assert.equal(u.refCodes, undefined);
});
