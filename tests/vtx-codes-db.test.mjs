// The invite code rename, against a real Postgres: a new account gets a VTX- code, and an old OPUS- code (kept in codes and in oldCodes)
// still finds the inviter, links a new friend, and counts under the default code.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, q, getUser, withUser } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');
const referrals = await import('@/lib/server/referrals');

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

test('an old code finds the inviter, links a friend and counts under the default code', async () => {
  const inv = await account('old1');
  const code = (await getUser(inv)).refCode;
  const old = `OPUS-${code.slice(4)}`;
  await withUser(inv, (u) => {
    u.oldCodes = [old];
  });
  await q('INSERT INTO codes (code, user_id) VALUES ($1, $2)', [old, inv]);

  const hit = await referrals.resolveCode(old);
  assert.equal(hit.user.id, inv);
  assert.equal(hit.code, code, 'the old code counts as the default code');
  assert.equal(hit.rebate, 0);

  const friend = await account('old1f', old);
  const f = await getUser(friend);
  assert.equal(f.refBy, inv);
  assert.equal(f.refUsed, code);

  // A friend who signed up with the old code before the rename is still counted under the default code.
  await withUser(friend, (x) => {
    x.refUsed = old;
  });
  const rows = referrals.codesOfCtx(await referrals.getRefCtx(inv));
  assert.equal(rows[0].code, code);
  assert.equal(rows[0].friends, 1);
});
