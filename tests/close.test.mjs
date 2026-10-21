// Closing your own account, against a real Postgres: the checks hold (password, code, DELETE, unfinished money, forfeit),
// the personal data is gone, the email can be used again, the books keep their rows, and an inviter's rewards do not move.
// Each test uses its own accounts, so reruns on the same database are fine.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const { pool, q, getUser, withUser } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');
const miners = await import('@/lib/server/miners');
const { getWallet } = await import('@/lib/server/wallet');
const { getReferral } = await import('@/lib/server/account');
const { MIN_WITHDRAW, customPlan } = await import('@/lib/data');
const totp = await import('@/lib/server/totp');

const run = `c${Date.now().toString(36)}`;
const PW = 'correct horse 1';

const email = (name) => `${name}-${run}@test.dev`;
async function account(name, extra = {}) {
  const e = email(name);
  assert.ok((await auth.signup({ email: e, password: PW, ...extra })).ok);
  return e;
}
// Test money: a negative "withdrawn" adds to the available balance.
const credit = (id, btc) =>
  withUser(id, (u) => {
    u.withdrawn = (u.withdrawn || 0) - btc;
  });
const availOf = async (id) => {
  const w = await getWallet(id);
  return w.earned - w.withdrawn - w.spent;
};
const empty = async (id) => {
  const left = await availOf(id);
  await withUser(id, (u) => {
    u.withdrawn = (u.withdrawn || 0) + left;
  });
};
let seq = 0;
const starter = () => customPlan(15, 90, miners.getCatalog().halls);
// An order the admin screen can list (it needs a plan), for rows the tests add by hand.
const orderData = (id, status) => JSON.stringify({ id, plan: { ...starter() }, usd: starter().price, status, at: Date.now() });
async function buy(id) {
  const r = await miners.buyPlan({ planId: 'custom', th: 15, days: 90, pay: 'balance' }, { userId: id, key: `${run}-${++seq}` });
  assert.ok(r.ok, r.error);
  return r.contract.serial;
}
const close = (id, extra = {}) => auth.closeAccount(id, { password: PW, confirm: 'DELETE', forfeit: true, ...extra });
const exists = async (id) => (await q('SELECT 1 FROM users WHERE id = $1', [id])).rowCount > 0;

before(async () => {
  await migrate();
});

after(async () => {
  await pool().end();
});

test('closing erases the sign-in data, frees the email and keeps the books under a random id', async () => {
  const id = await account('ok');
  await credit(id, 0.01);
  await buy(id);
  await empty(id);
  const ord = { id: `ord_${run}_k`, status: 'cancelled', at: Date.now() };
  await q('INSERT INTO orders (id, user_id, status, at, data, idem_key) VALUES ($1, $2, $3, $4, $5::jsonb, NULL)', [ord.id, id, ord.status, ord.at, orderData(ord.id, ord.status)]);
  await q('INSERT INTO withdrawals (id, user_id, status, at, data, idem_key) VALUES ($1, $2, $3, $4, $5::jsonb, NULL)', [`wd_${run}_k`, id, 'sent', Date.now(), JSON.stringify({ id: `wd_${run}_k`, address: 'bc1qtest' })]);
  await q("INSERT INTO ledger (user_id, kind, btc, usd, ref) VALUES ($1, 'spend', 0.001, 10, 'test')", [id]);
  const code = (await getUser(id)).refCode;

  const r = await close(id);
  assert.ok(r.ok, r.error);

  assert.equal(await exists(id), false, 'the email is no longer an account');
  assert.equal((await auth.login({ email: id, password: PW })).ok, false);
  const gone = (await q('SELECT user_id FROM orders WHERE id = $1', [ord.id])).rows[0].user_id;
  assert.match(gone, /^closed:/);
  assert.equal((await q('SELECT user_id FROM withdrawals WHERE id = $1', [`wd_${run}_k`])).rows[0].user_id, gone);
  assert.equal((await q("SELECT count(*)::int AS n FROM ledger WHERE user_id = $1 AND kind = 'spend' AND ref = 'test'", [gone])).rows[0].n, 1);
  assert.equal((await q('SELECT count(*)::int AS n FROM ledger WHERE user_id = $1', [id])).rows[0].n, 0);

  const row = (await q('SELECT data FROM users WHERE id = $1', [gone])).rows[0].data;
  const text = JSON.stringify(row);
  assert.ok(!text.includes(id), 'the email appears nowhere on the record');
  for (const k of ['email', 'pw', 'twofa', 'kyc', 'notifications', 'prefs', 'tgName']) assert.equal(row[k], undefined, k);
  assert.ok(row.closedAt);
  assert.equal(row.contracts.length, 1);
  assert.equal((await q('SELECT 1 FROM codes WHERE code = $1', [code])).rowCount, 0, 'the invite code is freed');

  // The same email can open a fresh account.
  assert.ok((await auth.signup({ email: id, password: PW })).ok);
  assert.equal((await getUser(id)).contracts.length, 0);
  await q('DELETE FROM orders WHERE id = $1', [ord.id]);
  await q('DELETE FROM withdrawals WHERE id = $1', [`wd_${run}_k`]);
});

test('a wrong password, a missing DELETE or the demo account change nothing', async () => {
  const id = await account('guard');
  const bad = await close(id, { password: 'wrong password' });
  assert.equal(bad.status, 422);
  assert.equal(bad.field, 'password');
  assert.equal((await close(id, { confirm: 'nope' })).status, 422);
  assert.equal((await auth.closeAccount('demo', { confirm: 'DELETE' })).ok, false);
  assert.equal((await auth.closeAccount(`nobody-${run}@test.dev`, { password: PW, confirm: 'DELETE' })).status, 404);
  assert.ok(await exists(id));
  assert.ok((await auth.login({ email: id, password: PW })).ok);
});

test('unfinished money blocks it: a pending withdrawal, an open payment, or a balance that can still be withdrawn', async () => {
  const a = await account('wd');
  await q('INSERT INTO withdrawals (id, user_id, status, at, data, idem_key) VALUES ($1, $2, $3, $4, $5::jsonb, NULL)', [`wd_${run}_p`, a, 'pending', Date.now(), '{}']);
  const r1 = await close(a);
  assert.equal(r1.status, 409);
  assert.match(r1.error, /withdrawal/);
  assert.match((await auth.closePreview(a)).blocked, /withdrawal/);
  assert.ok(await exists(a));

  const b = await account('ord');
  await q('INSERT INTO orders (id, user_id, status, at, data, idem_key) VALUES ($1, $2, $3, $4, $5::jsonb, NULL)', [`ord_${run}_o`, b, 'pending', Date.now(), orderData(`ord_${run}_o`, 'pending')]);
  assert.match((await close(b)).error, /payment/);

  const c = await account('bal');
  await credit(c, MIN_WITHDRAW * 2);
  const r3 = await close(c);
  assert.equal(r3.status, 409);
  assert.match(r3.error, /Withdraw your balance/);
  await empty(c);
  await credit(c, MIN_WITHDRAW / 2); // below the minimum: cannot be paid out, so it may be given up
  assert.ok((await close(c)).ok);
  await q('DELETE FROM withdrawals WHERE id = $1', [`wd_${run}_p`]);
  await q('DELETE FROM orders WHERE id = $1', [`ord_${run}_o`]);
});

test('running miners need the person to agree they end with no refund', async () => {
  const id = await account('miner');
  await credit(id, 0.01);
  await buy(id);
  await empty(id);
  const pre = await auth.closePreview(id);
  assert.equal(pre.miners, 1);
  assert.equal(pre.blocked, null);
  assert.equal(pre.password, true);

  const r = await close(id, { forfeit: false });
  assert.equal(r.status, 409);
  assert.equal(r.forfeit, true);
  assert.equal(r.field, undefined, 'asking for the tick is not a failed attempt');
  assert.ok(await exists(id));
  assert.ok((await close(id)).ok);
});

test('with two-factor on, a code is needed, and a recovery code works once', async () => {
  const id = await account('tf');
  const recovery = 'ABCDE12345';
  await withUser(id, (u) => {
    u.twofa = { secret: totp.newSecret(), last: 0, codes: [createHash('sha256').update(recovery).digest('hex')], at: Date.now() };
  });
  assert.equal((await auth.closePreview(id)).twofa, true);
  const none = await close(id);
  assert.equal(none.need2fa, true);
  assert.equal(none.field, 'code');
  assert.equal((await close(id, { code: '123456' })).status, 422);
  assert.ok(await exists(id));
  assert.ok((await close(id, { code: 'ABCDE-12345' })).ok);
  assert.equal(await exists(id), false);
});

test('closing a friend does not change what the inviter earned, and the list calls them a closed account', async () => {
  const inv = await account('inv');
  const code = (await getUser(inv)).refCode;
  const fr = await account('friend', { ref: code });
  await credit(fr, 0.02);
  await buy(fr);
  await empty(fr);
  const before = await availOf(inv);
  assert.ok(before > 0, 'the inviter has a reward to protect');

  const r = await close(fr);
  assert.ok(r.ok, r.error);

  assert.ok(Math.abs((await availOf(inv)) - before) < 1e-9);
  const list = (await getReferral(inv)).friends;
  assert.equal(list.length, 1);
  assert.equal(list[0].who, 'Closed account');
  assert.match(list[0].id, /^closed:/);
  assert.equal((await getUser(inv)).refCode, code);
});

test('closing an inviter keeps their friends linked and the closed code stops working', async () => {
  const inv = await account('inv2');
  const code = (await getUser(inv)).refCode;
  const fr = await account('fr2', { ref: code });
  assert.equal((await getUser(fr)).refBy, inv);

  assert.ok((await close(inv)).ok);

  const f = await getUser(fr);
  assert.match(f.refBy, /^closed:/);
  assert.equal((await q('SELECT ref_by FROM users WHERE id = $1', [fr])).rows[0].ref_by, f.refBy);
  const late = await account('fr3', { ref: code });
  assert.equal((await getUser(late)).refBy, undefined, 'a closed account cannot be used as an invite code any more');
});
