// Invite codes live only in the codes table. This follows them through a whole life: removing a named code, closing the account,
// the sign-up screen check, and a restore from a backup.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, defaultCodeOf, codesOfUsers, codeOwner } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');
const referrals = await import('@/lib/server/referrals');
const { makeBackup, restoreBackup } = await import('@/lib/server/db-backup');

const run = `cl${Date.now().toString(36)}`;
const email = (n) => `${n}-${run}@test.dev`;
const PW = 'correct horse 1';
const rowOf = async (code) => (await pool().query('SELECT user_id, name, rebate, is_default FROM codes WHERE code = $1', [code]))?.rows[0] || null;
const named = async (id) => (await codesOfUsers([id])).get(id).filter((k) => !k.default);

before(async () => {
  await migrate();
});

after(async () => {
  await pool().end();
});

test('a named code can be removed: the row goes, the sign-up check fails, the owner is gone', async () => {
  const id = email('del');
  assert.ok((await auth.signup({ email: id, password: PW })).ok);
  assert.ok((await referrals.createCode(id, { name: 'Temp', rebate: 1 })).ok);
  const code = (await named(id))[0].code;
  assert.equal((await referrals.publicCode(code)).valid, true);
  assert.ok((await referrals.deleteCode(id, code.toLowerCase())).ok);
  assert.equal(await rowOf(code), null);
  assert.equal(await codeOwner(code), null);
  assert.deepEqual(await referrals.publicCode(code), { valid: false, rebate: 0 });
  assert.equal((await named(id)).length, 0);
  assert.equal((await referrals.deleteCode(id, code)).status, 404, 'removing it twice finds nothing');
});

test('the default code cannot be removed, and nobody can remove another account\'s code', async () => {
  const a = email('da');
  const b = email('db');
  assert.ok((await auth.signup({ email: a, password: PW })).ok);
  assert.ok((await auth.signup({ email: b, password: PW })).ok);
  const def = await defaultCodeOf(a);
  assert.equal((await referrals.deleteCode(a, def)).status, 404);
  assert.ok((await referrals.createCode(a, { name: 'Mine', rebate: 0 })).ok);
  const mine = (await named(a))[0].code;
  assert.equal((await referrals.deleteCode(b, mine)).status, 404);
  assert.ok(await rowOf(def));
  assert.ok(await rowOf(mine));
});

test('a code with a friend cannot be removed, and stays after the refusal', async () => {
  const inv = email('inv');
  const fr = email('fr');
  assert.ok((await auth.signup({ email: inv, password: PW })).ok);
  assert.ok((await auth.signup({ email: fr, password: PW })).ok);
  assert.ok((await referrals.createCode(inv, { name: 'Pals', rebate: 2 })).ok);
  const code = (await named(inv))[0].code;
  await pool().query("UPDATE users SET ref_by = $1, data = jsonb_set(data, '{refUsed}', to_jsonb($2::text)) WHERE id = $3", [inv, code, fr]);
  const r = await referrals.deleteCode(inv, code);
  assert.equal(r.ok, false);
  assert.equal(r.status, 422);
  assert.equal((await rowOf(code)).rebate, 2);
});

test('closing an account frees both codes: rows gone, sign-up check fails, no code left under the old id', async () => {
  const id = email('close');
  assert.ok((await auth.signup({ email: id, password: PW })).ok);
  assert.ok((await referrals.createCode(id, { name: 'Gone', rebate: 1 })).ok);
  const def = await defaultCodeOf(id);
  const code = (await named(id))[0].code;
  assert.equal((await referrals.publicCode(def)).valid, true);
  const r = await auth.closeAccount(id, { confirm: 'DELETE', password: PW });
  assert.equal(r.ok, true, JSON.stringify(r));
  for (const k of [def, code]) {
    assert.equal(await rowOf(k), null, `${k} is freed`);
    assert.equal(await referrals.resolveCode(k), null);
    assert.deepEqual(await referrals.publicCode(k), { valid: false, rebate: 0 });
  }
  assert.equal(((await codesOfUsers([id])).get(id) || []).length, 0);
  const left = (await pool().query("SELECT count(*)::int AS n FROM codes WHERE user_id LIKE 'closed:%' AND code IN ($1, $2)", [def, code])).rows[0].n;
  assert.equal(left, 0, 'no code points at the closed record');
});

test('an admin close frees the codes the same way', async () => {
  const id = email('adm');
  assert.ok((await auth.signup({ email: id, password: PW })).ok);
  assert.ok((await referrals.createCode(id, { name: 'Boss', rebate: 0 })).ok);
  const codes = (await codesOfUsers([id])).get(id).map((k) => k.code);
  assert.equal(codes.length, 2);
  const r = await auth.closeByAdmin(id);
  assert.equal(r.ok, true, JSON.stringify(r));
  for (const k of codes) assert.equal(await rowOf(k), null);
});

test('a restore brings codes back with name and rebate, and drops codes made after the backup', async () => {
  const id = email('rest');
  assert.ok((await auth.signup({ email: id, password: PW })).ok);
  assert.ok((await referrals.createCode(id, { name: 'Kept', rebate: 3 })).ok);
  const def = await defaultCodeOf(id);
  const kept = (await named(id))[0].code;
  const b = await makeBackup();
  assert.equal(b.ok, true);

  assert.ok((await referrals.createCode(id, { name: 'Later', rebate: 1 })).ok);
  const later = (await named(id)).find((k) => k.name === 'Later').code;
  await pool().query('UPDATE codes SET rebate = 5 WHERE code = $1', [kept]);
  assert.ok(await rowOf(later));

  const r = await restoreBackup(b.buf, 'RESTORE');
  assert.equal(r.ok, true, JSON.stringify(r));
  const d = await rowOf(def);
  assert.deepEqual([d.user_id, d.name, d.rebate, d.is_default], [id, 'Default', 0, true]);
  const k = await rowOf(kept);
  assert.deepEqual([k.user_id, k.name, k.rebate, k.is_default], [id, 'Kept', 3, false], 'the rebate is back to the backup value');
  assert.equal(await rowOf(later), null, 'the code made after the backup is gone');
  assert.equal((await referrals.publicCode(kept)).rebate, 3);
});
