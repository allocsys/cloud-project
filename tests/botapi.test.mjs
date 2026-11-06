// Bot -> app signed API: the signature check and /balance.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, tx, withUser, createUser } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const { signBody } = await import('@/lib/server/botnotify');
const { verifyCall, serve, balanceFor } = await import('@/lib/server/botapi');
const { addLot } = await import('@/lib/deposit-hold');
const { pricesFor } = await import('@/lib/server/prices');

const SECRET = 'k'.repeat(32);
const env = { APP_BOT_SECRET: SECRET };
const post = (body, secret = SECRET) => {
  const raw = JSON.stringify(body);
  return [raw, signBody(body, secret)];
};
const call = (extra, opts) => {
  const [raw, sig] = post({ sent_at: new Date().toISOString(), ...extra }, opts?.secret);
  return serve(raw, sig, balanceFor, { env });
};
const tgId = (n) => 7000000 + ((Date.now() + n) % 1000000);

before(async () => {
  await migrate();
});
after(async () => {
  await pool().end();
});

test('verifyCall accepts a good signature and refuses a wrong secret, an old copy, a changed body and junk', () => {
  const body = { tg_id: 5, sent_at: new Date().toISOString() };
  const [raw, sig] = post(body);
  assert.deepEqual(verifyCall(raw, sig, SECRET), body);
  assert.equal(verifyCall(raw, sig, 'z'.repeat(32)), null, 'wrong secret');
  assert.equal(verifyCall(raw, sig, SECRET, Date.now() + 11 * 60_000), null, 'replay after 10 min');
  assert.equal(verifyCall(raw.replace('5', '6'), sig, SECRET), null, 'changed body');
  assert.equal(verifyCall(raw, '', SECRET), null, 'no signature');
  assert.equal(verifyCall('nope', sig, SECRET), null, 'not JSON');
  assert.equal(verifyCall('[1]', sig, SECRET), null, 'not an object');
  const [noTime, s2] = post({ tg_id: 5 });
  assert.equal(verifyCall(noTime, s2, SECRET), null, 'no sent_at');
});

test('serve is off without a secret and refuses a bad signature before anything runs', async () => {
  let ran = 0;
  const fn = async () => (ran++, { status: 200, json: { ok: true } });
  const [raw, sig] = post({ sent_at: new Date().toISOString() });
  assert.equal((await serve(raw, sig, fn, { env: {} })).status, 503);
  assert.equal((await serve(raw, sig, fn, { env: { APP_BOT_SECRET: 'short' } })).status, 503);
  assert.equal((await serve(raw, 'ab'.repeat(64), fn, { env })).status, 401);
  assert.equal(ran, 0);
  assert.equal((await serve(raw, sig, fn, { env })).status, 200);
  assert.equal(ran, 1);
});

test('/balance: bad id 400, no account 404 and nothing is created', async () => {
  assert.equal((await call({ tg_id: 'x' })).status, 400);
  assert.equal((await call({ tg_id: -4 })).status, 400);
  assert.equal((await call({})).status, 400);
  const id = tgId(1);
  assert.equal((await call({ tg_id: id })).status, 404);
  assert.equal((await pool().query('SELECT 1 FROM users WHERE id = $1', [`tg:${id}`])).rowCount, 0);
});

test('/balance: balance, locked part and USD for a Telegram account', async () => {
  const n = tgId(2);
  const id = `tg:${n}`;
  await tx((c) => createUser(c, id));
  const empty = await call({ tg_id: n });
  assert.equal(empty.status, 200);
  assert.equal(empty.json.btc, 0);
  assert.equal(empty.json.locked, 0);
  assert.equal(empty.json.usd, 0);

  await withUser(id, (u) => {
    u.withdrawn = -0.01; // test trick: a negative withdrawn adds balance
    addLot(u, 0.004); // a fresh deposit, no plan: still locked
  });
  const r = await call({ tg_id: n });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.btc, 0.01);
  assert.equal(r.json.locked, 0.004);
  const pr = await pricesFor(['btc']);
  assert.equal(r.json.usd, Math.round(0.01 * pr.prices.btc * 100) / 100);
});

test('/balance: a negative balance shows as 0 and is never more than the balance locked', async () => {
  const n = tgId(3);
  const id = `tg:${n}`;
  await tx((c) => createUser(c, id));
  await withUser(id, (u) => {
    u.withdrawn = 0.5; // owes more than it has
    addLot(u, 0.2);
  });
  const r = await call({ tg_id: n });
  assert.equal(r.status, 200);
  assert.equal(r.json.btc, 0);
  assert.equal(r.json.locked, 0);
});

test('/balance: an email account is not reachable by a Telegram id', async () => {
  const mail = `bal${Date.now()}@x.test`;
  await tx((c) => createUser(c, mail));
  assert.equal((await call({ tg_id: 1234567890123 })).status, 404);
});
