// The sign-in and password-reset routes give a reserved attempt back when the two-factor code limit answers first:
// repeated code-limit 429s must not push the address or the account toward their own lockouts.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const { NextRequest } = await import('next/server');
const { pool, q, withUser } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');
const totp = await import('@/lib/server/totp');
const loginRoute = await import('@/app/api/auth/login/route');
const confirmRoute = await import('@/app/api/auth/reset/confirm/route');

const run = `lt${Date.now().toString(36)}`;
const PW = 'correct horse 1';
const realNow = totp.clock.now;
let t = Date.UTC(2026, 9, 20, 12, 0, 0);
const tick = (n = 1) => {
  t += n * 30_000;
};
const code = (secret, step = totp.stepOf()) => totp.codeAt(secret, step);
const sha = (s) => createHash('sha256').update(s).digest('hex');

async function call(handler, url, { body, ip = '10.0.0.1' } = {}) {
  const headers = { 'content-type': 'application/json', 'x-forwarded-for': ip };
  const res = await handler(new NextRequest(`http://app.test${url}`, { method: 'POST', headers, body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
}
// An account with two-factor on, already moved to a fresh step so its next code is accepted.
async function withTwofa(name) {
  const id = `${name}-${run}@test.dev`;
  assert.ok((await auth.signup({ email: id, password: PW })).ok);
  const s = await auth.twofaStart(id);
  assert.ok(s.ok, JSON.stringify(s));
  const r = await auth.twofaEnable(id, { code: code(s.secret) });
  assert.ok(r.ok, JSON.stringify(r));
  tick();
  return { id, secret: s.secret };
}

// The throttle table, as the routes count it: key -> n.
const count = async (key) => Number((await q('SELECT n FROM throttle WHERE key = $1', [key])).rows[0]?.n || 0);
// Puts a counter at its limit, so the next reserve() of it answers 429.
const saturate = (key) => q('INSERT INTO throttle (key, n, until_ms) VALUES ($1, 8, $2) ON CONFLICT (key) DO UPDATE SET n = 8, until_ms = EXCLUDED.until_ms', [key, Date.now() + 15 * 60_000]);

before(async () => {
  totp.clock.now = () => t;
  await migrate();
});
after(async () => {
  totp.clock.now = realNow;
  await pool().end();
});

test('sign-in: code-limit 429s give the address and account attempts back', async () => {
  const { id } = await withTwofa('code429');
  const ip = '10.11.11.11';
  await saturate(`auth:t:${id}`);
  for (let i = 0; i < 5; i += 1) {
    const r = await call(loginRoute.POST, '/api/auth/login', { body: { email: id, password: PW, code: '123456' }, ip });
    assert.equal(r.status, 429, `code-limit hit ${i + 1}`);
  }
  assert.equal(await count(`auth:l:${ip}:${id}`), 0, 'the address attempts were given back');
  assert.equal(await count(`auth:a:${id}`), 0, 'the account attempts were given back');
  assert.ok((await count(`auth:t:${id}`)) > 8, 'the code limit itself stays in force');
  // Five code-limit hits must not have locked the account: the right password still asks for its code.
  const ask = await call(loginRoute.POST, '/api/auth/login', { body: { email: id, password: PW }, ip });
  assert.equal(ask.status, 401, JSON.stringify(ask.body));
  assert.equal(ask.body.need2fa, true);
});

test('reset confirm: code-limit 429s give the address attempt back', async () => {
  const { id } = await withTwofa('reset429');
  const token = `reset429-token-${run}`;
  await withUser(id, (u) => {
    u.reset = { h: sha(token), exp: Date.now() + 60_000, at: Date.now() };
  });
  const ip = '10.12.12.12';
  await saturate(`auth:t:${id}`);
  for (let i = 0; i < 8; i += 1) {
    const r = await call(confirmRoute.POST, '/api/auth/reset/confirm', { body: { email: id, token, password: 'a new password 6', code: '123456' }, ip });
    assert.equal(r.status, 429, `code-limit hit ${i + 1}`);
  }
  assert.equal(await count(`auth:c:${ip}`), 0, 'the address attempts were given back');
  assert.ok((await count(`auth:t:${id}`)) > 8, 'the code limit itself stays in force');
  // Eight code-limit hits must not have locked the address: the valid link still asks for its code.
  const ask = await call(confirmRoute.POST, '/api/auth/reset/confirm', { body: { email: id, token, password: 'a new password 6' }, ip });
  assert.equal(ask.status, 401, JSON.stringify(ask.body));
  assert.equal(ask.body.need2fa, true);
});
