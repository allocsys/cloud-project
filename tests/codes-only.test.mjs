// Migration 005: accounts stop holding refCode and refCodes. What the codes table lacks is added first, filled rows keep what they
// have (a rebate raised later is never put back), and running it again changes nothing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, getUser, defaultCodeOf, codesOfUsers } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const { MIGRATIONS } = await import('@/lib/server/migrations');
const auth = await import('@/lib/server/auth');
const referrals = await import('@/lib/server/referrals');

const run = `co${Date.now().toString(36)}`;
const email = (n) => `${n}-${run}@test.dev`;
const PW = 'correct horse 1';
const step = () => MIGRATIONS.find((m) => m.id === '005_codes_only');
const rowOf = async (code) => (await pool().query('SELECT user_id, name, rebate, is_default FROM codes WHERE code = $1', [code]))?.rows[0] || null;

before(async () => {
  await migrate();
});

after(async () => {
  await pool().end();
});

test('the step exists and new accounts never hold the fields', async () => {
  assert.ok(step());
  const id = email('new');
  assert.ok((await auth.signup({ email: id, password: PW })).ok);
  assert.ok((await referrals.createCode(id, { name: 'Pals', rebate: 2 })).ok);
  const u = await getUser(id);
  assert.equal(u.refCode, undefined);
  assert.equal(u.refCodes, undefined);
});

test('old fields go, missing rows come back, filled rows are left alone, and a second run changes nothing', async () => {
  const id = email('old');
  assert.ok((await auth.signup({ email: id, password: PW })).ok);
  assert.ok((await referrals.createCode(id, { name: 'Pals', rebate: 5 })).ok);
  const def = await defaultCodeOf(id);
  const named = (await codesOfUsers([id])).get(id).find((k) => !k.default).code;
  // An account from before: its document holds both codes, the default one has no row, and the named rebate was raised in the table since.
  await pool().query("UPDATE users SET data = data || jsonb_build_object('refCode', $2::text, 'refCodes', jsonb_build_array(jsonb_build_object('code', $3::text, 'name', 'Pals', 'rebate', 1, 'at', 5))) WHERE id = $1", [id, def, named]);
  await pool().query('DELETE FROM codes WHERE code = $1', [def]);
  await pool().query(step().sql);
  const u = await getUser(id);
  assert.equal(u.refCode, undefined);
  assert.equal(u.refCodes, undefined);
  const d = await rowOf(def);
  assert.deepEqual([d.user_id, d.name, d.rebate, d.is_default], [id, 'Default', 0, true], 'the missing row is back');
  assert.equal((await rowOf(named)).rebate, 5, 'a raised rebate is not put back');
  const before = JSON.stringify((await codesOfUsers([id])).get(id));
  await pool().query(step().sql);
  assert.equal(JSON.stringify((await codesOfUsers([id])).get(id)), before);
});

test('a closed account loses the fields too, and gets no code row', async () => {
  const id = 'closed:co-' + run;
  await pool().query("INSERT INTO users (id, data) VALUES ($1, $2::jsonb)", [id, JSON.stringify({ closedAt: 1, refCode: 'VTX-GONE', refCodes: [{ code: 'VTX-GON2', name: 'x', rebate: 1 }] })]);
  await pool().query(step().sql);
  const u = (await pool().query('SELECT data FROM users WHERE id = $1', [id])).rows[0].data;
  assert.equal(u.refCode, undefined);
  assert.equal(u.refCodes, undefined);
  assert.equal(await rowOf('VTX-GONE'), null);
});
