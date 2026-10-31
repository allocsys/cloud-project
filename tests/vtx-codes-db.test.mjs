// The invite code format, against a real Postgres: a new account gets a VTX- code.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, getUser } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');

const run = `v${Date.now().toString(36)}`;
const PW = 'correct horse 1';
const rnd = () => Math.floor(Math.random() * 200) + 20;
const net = () => `${rnd()}.${rnd()}.${rnd()}.9`;

async function account(name, ref = '') {
  const e = `${name}-${run}@test.dev`;
  assert.ok((await auth.signup({ email: e, password: PW, ref }, net())).ok);
  return e;
}

before(async () => {
  await migrate();
});

after(async () => {
  await pool().end();
});

test('a new account gets a VTX- code', async () => {
  const inv = await account('new1');
  assert.match((await getUser(inv)).refCode, /^VTX-[A-Z2-9]{4}$/);
});
