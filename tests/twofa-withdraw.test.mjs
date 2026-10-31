// Withdrawals with two-factor on: no code and a wrong code are refused (nothing is taken), a right code works once, a recovery code works,
// the route limits wrong codes, and an account without two-factor is unchanged. Against a real Postgres; the code clock is replaced.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { NextRequest } = await import('next/server');
const { pool, q, getUser, withUser } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');
const totp = await import('@/lib/server/totp');
const { withdraw } = await import('@/lib/server/wallet');
const route = await import('@/app/api/wallet/withdraw/route');

const run = `x${Date.now().toString(36)}`;
const PW = 'correct horse 1';
const ADDR = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
const realNow = totp.clock.now;
let t = Date.UTC(2026, 9, 20, 12, 0, 0);
const tick = (n = 1) => {
  t += n * 30_000;
};
const code = (secret) => totp.codeAt(secret, totp.stepOf());
const wrongOf = (c) => c.slice(0, 5) + String((Number(c[5]) + 1) % 10);
const credit = (id, btc) =>
  withUser(id, (u) => {
    u.withdrawn = (u.withdrawn || 0) - btc;
  });
const rows = async (id) => (await q('SELECT count(*)::int AS n FROM withdrawals WHERE user_id = $1', [id])).rows[0].n;
const ask = (id, extra = {}) => withdraw({ asset: 'btc', net: 'btc', amount: 0.001, address: ADDR, ...extra }, { userId: id, key: `k${Date.now()}${Math.random()}` });

async function account(name, twofa) {
  const id = `${name}-${run}@test.dev`;
  assert.ok((await auth.signup({ email: id, password: PW })).ok);
  await credit(id, 0.05);
  if (!twofa) return { id };
  const s = await auth.twofaStart(id);
  const r = await auth.twofaEnable(id, { code: code(s.secret) });
  assert.ok(r.ok, JSON.stringify(r));
  tick();
  return { id, secret: s.secret, codes: r.codes };
}

before(async () => {
  totp.clock.now = () => t;
  await migrate();
});
after(async () => {
  totp.clock.now = realNow;
  await pool().end();
});

test('without two-factor nothing changes', async () => {
  const { id } = await account('plain', false);
  assert.ok((await ask(id)).ok);
  assert.equal(await rows(id), 1);
});

test('with two-factor on, no code and a wrong code are refused and take nothing', async () => {
  const { id, secret } = await account('tf1', true);
  const before1 = (await getUser(id)).withdrawn;
  const none = await ask(id);
  assert.equal(none.ok, false);
  assert.equal(none.need2fa, true);
  assert.equal(none.field, 'code');
  assert.equal(none.error, 'Enter your two-factor code to withdraw.');
  const bad = await ask(id, { code: wrongOf(code(secret)) });
  assert.equal(bad.ok, false);
  assert.equal(bad.need2fa, undefined);
  assert.equal(bad.error, 'That code is wrong. Try again.');
  assert.equal(await rows(id), 0);
  assert.equal((await getUser(id)).withdrawn, before1);
});

test('a right code works once; the next withdrawal needs the next code', async () => {
  const { id, secret } = await account('tf2', true);
  const c = code(secret);
  assert.ok((await ask(id, { code: c })).ok);
  assert.equal((await ask(id, { code: c })).ok, false, 'the same code is used up');
  tick();
  assert.ok((await ask(id, { code: code(secret) })).ok);
  assert.equal(await rows(id), 2);
});

test('a recovery code works once', async () => {
  const { id, codes } = await account('tf3', true);
  assert.ok((await ask(id, { code: codes[0] })).ok);
  assert.equal((await ask(id, { code: codes[0] })).ok, false);
});

test('a failed withdrawal for another reason does not use the code up', async () => {
  const { id, secret } = await account('tf4', true);
  const c = code(secret);
  assert.equal((await ask(id, { code: c, amount: 100 })).ok, false); // more than the balance
  assert.ok((await ask(id, { code: c })).ok, 'the same code still works');
});

test('the route counts wrong codes and stops after too many', async () => {
  const { id, secret } = await account('tf5', true);
  const cookie = `${auth.COOKIE}=${await auth.newSession(id)}`;
  const post = async (body) => {
    const res = await route.POST(new NextRequest('http://app.test/api/wallet/withdraw', { method: 'POST', headers: { 'content-type': 'application/json', cookie, 'x-forwarded-for': '10.0.0.9' }, body: JSON.stringify(body) }));
    return { status: res.status, body: await res.json() };
  };
  const bad = wrongOf(code(secret));
  let last;
  for (let i = 0; i < 12; i++) last = await post({ asset: 'btc', net: 'btc', amount: 0.001, address: ADDR, code: bad });
  assert.equal(last.status, 429);
  assert.equal(await rows(id), 0);
});
