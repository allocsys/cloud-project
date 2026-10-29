// Two-factor sign-in: the one-time code maths against the RFC 6238 test vectors, then setting it up, signing in with it,
// recovery codes, turning it off, password reset, and the lockout, against a real Postgres. The clock the codes use is
// replaced, so a test can move to the next 30 second step without waiting.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const { NextRequest } = await import('next/server');
const { pool, tx, createUser, getUser, withUser } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');
const totp = await import('@/lib/server/totp');
const loginRoute = await import('@/app/api/auth/login/route');
const twofaRoute = await import('@/app/api/auth/2fa/route');
const confirmRoute = await import('@/app/api/auth/reset/confirm/route');

const run = `f${Date.now().toString(36)}`;
const PW = 'correct horse 1';
const realNow = totp.clock.now;
let t = Date.UTC(2026, 9, 20, 12, 0, 0);
const tick = (n = 1) => {
  t += n * 30_000;
};
const code = (secret, step = totp.stepOf()) => totp.codeAt(secret, step);
const wrongOf = (c) => c.slice(0, 5) + String((Number(c[5]) + 1) % 10);

async function account(name) {
  const e = `${name}-${run}@test.dev`;
  assert.ok((await auth.signup({ email: e, password: PW })).ok);
  return e;
}
// An account with two-factor on, already moved to a fresh step so its next code is accepted.
async function withTwofa(name) {
  const id = await account(name);
  const s = await auth.twofaStart(id);
  assert.ok(s.ok, JSON.stringify(s));
  const r = await auth.twofaEnable(id, { code: code(s.secret) });
  assert.ok(r.ok, JSON.stringify(r));
  tick();
  return { id, secret: s.secret, codes: r.codes };
}
const login = (id, extra = {}) => auth.login({ email: id, password: PW, ...extra });
const sha = (s) => createHash('sha256').update(s).digest('hex');
const titles = async (id) => (await getUser(id)).notifications.map((n) => n.title);

async function call(handler, url, { cookie, body, ip = '10.0.0.1' } = {}) {
  const headers = { 'content-type': 'application/json', 'x-forwarded-for': ip };
  if (cookie) headers.cookie = cookie;
  const res = await handler(new NextRequest(`http://app.test${url}`, { method: 'POST', headers, body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json(), headers: res.headers };
}
const cookieOf = async (id) => `${auth.COOKIE}=${await auth.newSession(id)}`;

before(async () => {
  totp.clock.now = () => t;
  await migrate();
});
after(async () => {
  totp.clock.now = realNow;
  await pool().end();
});

test('codes match the RFC 6238 test vectors, and base32 round-trips', () => {
  const secret = totp.base32(Buffer.from('12345678901234567890'));
  assert.equal(secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  for (const [seconds, want] of [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037'], [20000000000, '353130']]) {
    assert.equal(totp.codeAt(secret, totp.stepOf(seconds * 1000)), want, `t=${seconds}`);
  }
  assert.equal(totp.base32(Buffer.from('foobar')), 'MZXW6YTBOI');
  assert.equal(totp.unbase32('mzxw 6ytb-oi').toString(), 'foobar');
  assert.equal(totp.unbase32('1abc'), null);
  assert.equal(totp.unbase32(''), null);
  const s = totp.newSecret();
  assert.match(s, /^[A-Z2-7]{32}$/);
  assert.notEqual(s, totp.newSecret());
});

test('a code is accepted one step either side, once, and only as six digits', () => {
  const s = totp.newSecret();
  const now = Date.UTC(2026, 9, 20, 12, 0, 10);
  const cur = totp.stepOf(now);
  assert.equal(totp.verify(s, code(s, cur), { now }), cur);
  assert.equal(totp.verify(s, code(s, cur - 1), { now }), cur - 1);
  assert.equal(totp.verify(s, code(s, cur + 1), { now }), cur + 1);
  assert.equal(totp.verify(s, code(s, cur + 2), { now }), null);
  assert.equal(totp.verify(s, code(s, cur - 2), { now }), null);
  // A step already used (at or before `after`) is refused.
  assert.equal(totp.verify(s, code(s, cur), { now, after: cur }), null);
  assert.equal(totp.verify(s, code(s, cur - 1), { now, after: cur }), null);
  assert.equal(totp.verify(s, code(s, cur + 1), { now, after: cur }), cur + 1);
  for (const bad of ['', 'abc', '12345', '1234567', '12 34 5', null, undefined]) assert.equal(totp.verify(s, bad, { now }), null, String(bad));
  const c = code(s, cur);
  assert.equal(totp.verify(s, `${c.slice(0, 3)} ${c.slice(3)}`, { now }), cur, 'spaces are fine');
});

test('set up, sign in with a code, replay, recovery codes, and turning it off', async () => {
  const id = await account('flow');

  // Only email-and-password accounts can have it.
  assert.equal((await auth.twofaStart('demo')).status, 403);
  const tg = `tg:${run}`;
  assert.ok(await tx((c) => createUser(c, tg, {})));
  assert.equal((await auth.twofaStart(tg)).status, 403);
  assert.equal((await auth.twofaStart(`nobody-${run}@test.dev`)).status, 404);

  // Starting does not turn it on: sign-in still works without a code.
  const s = await auth.twofaStart(id);
  assert.ok(s.ok);
  assert.match(s.secret, /^[A-Z2-7]{32}$/);
  assert.ok(s.uri.startsWith('otpauth://totp/Vertexhash:'));
  assert.ok(s.uri.includes(encodeURIComponent(id)));
  assert.ok(s.uri.includes(`secret=${s.secret}`));
  assert.ok((await login(id)).ok);
  assert.equal((await auth.whoami(id)).twofa, false);

  // The first code must be right.
  const wrong = await auth.twofaEnable(id, { code: wrongOf(code(s.secret)) });
  assert.equal(wrong.status, 422);
  assert.equal(wrong.field, 'code');
  assert.equal((await auth.twofaEnable(id, { code: '' })).status, 422);
  assert.equal((await auth.whoami(id)).twofa, false);

  const on = await auth.twofaEnable(id, { code: code(s.secret) });
  assert.ok(on.ok, JSON.stringify(on));
  assert.equal(on.codes.length, 10);
  assert.equal(new Set(on.codes).size, 10);
  for (const c of on.codes) assert.match(c, /^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
  assert.equal((await auth.whoami(id)).twofa, true);
  assert.ok((await titles(id)).includes('Two-factor is on'));
  // The recovery codes are stored as hashes, never as given.
  const stored = JSON.stringify((await getUser(id)).twofa);
  for (const c of on.codes) assert.ok(!stored.includes(c) && !stored.includes(c.replace('-', '')));
  assert.equal((await auth.twofaStart(id)).status, 409);
  assert.equal((await auth.twofaEnable(id, { code: code(s.secret) })).status, 409);

  // Sign-in now needs the code. Asking for it is flagged, a wrong one is not.
  const ask = await login(id);
  assert.equal(ask.status, 401);
  assert.equal(ask.field, 'code');
  assert.equal(ask.need2fa, true);
  const bad = await login(id, { code: wrongOf(code(s.secret, totp.stepOf() + 1)) });
  assert.equal(bad.status, 401);
  assert.equal(bad.field, 'code');
  assert.ok(!bad.need2fa);
  // The code that turned it on is already used, so it cannot sign in. The next one can, once.
  assert.equal((await login(id, { code: code(s.secret) })).status, 401, 'same step as set-up');
  tick();
  const next = code(s.secret);
  assert.ok((await login(id, { code: next })).ok);
  assert.equal((await login(id, { code: next })).status, 401, 'replay');
  assert.equal((await login(id, { password: 'not the password', code: code(s.secret, totp.stepOf() + 1) })).status, 401);
  assert.equal((await login(id, { password: 'not the password' })).need2fa, undefined, 'a wrong password never reveals the second step');

  // A recovery code works once, in any case or spacing, and is announced.
  const rc = on.codes[0];
  assert.ok((await login(id, { code: rc.replace('-', '').toLowerCase() })).ok);
  assert.equal((await login(id, { code: rc })).status, 401);
  assert.equal((await getUser(id)).twofa.codes.length, 9);
  assert.ok((await titles(id)).includes('Recovery code used'));
  assert.equal((await login(id, { code: 'ABCDE-FGHIJ' })).status, 401);

  // Turning it off needs the password and a code.
  tick();
  const pw = await auth.twofaDisable(id, { password: 'nope nope nope', code: code(s.secret) });
  assert.equal(pw.status, 422);
  assert.equal(pw.field, 'password');
  const cd = await auth.twofaDisable(id, { password: PW, code: wrongOf(code(s.secret)) });
  assert.equal(cd.status, 422);
  assert.equal(cd.field, 'code');
  assert.equal((await auth.whoami(id)).twofa, true);
  assert.ok((await auth.twofaDisable(id, { password: PW, code: code(s.secret) })).ok);
  assert.equal((await auth.whoami(id)).twofa, false);
  assert.equal((await getUser(id)).twofa, undefined);
  assert.ok((await login(id)).ok, 'no code needed any more');
  assert.equal((await auth.twofaDisable(id, { password: PW, code: '123456' })).status, 409);
  assert.ok((await titles(id)).includes('Two-factor is off'));

  // Turned off with a recovery code instead of the app.
  const again = await auth.twofaStart(id);
  const on2 = await auth.twofaEnable(id, { code: code(again.secret) });
  assert.ok(on2.ok);
  assert.ok((await auth.twofaDisable(id, { password: PW, code: on2.codes[3] })).ok);
});

test('a setup key that was not confirmed in time is refused', async () => {
  const id = await account('expire');
  const s = await auth.twofaStart(id);
  await withUser(id, (u) => {
    u.twofaPending.at = Date.now() - 16 * 60_000;
  });
  assert.equal((await auth.twofaEnable(id, { code: code(s.secret) })).status, 409);
  assert.equal((await auth.whoami(id)).twofa, false);
  // A new start replaces the old key.
  const s2 = await auth.twofaStart(id);
  assert.notEqual(s2.secret, s.secret);
  assert.equal((await auth.twofaEnable(id, { code: code(s.secret) })).status, 422);
  assert.ok((await auth.twofaEnable(id, { code: code(s2.secret) })).ok);
});

test('a password reset link alone does not get past two-factor', async () => {
  const { id, secret, codes } = await withTwofa('reset');
  const token = `reset-token-${run}`;
  const arm = () =>
    withUser(id, (u) => {
      u.reset = { h: sha(token), exp: Date.now() + 60_000, at: Date.now() };
    });
  const NEW = 'a brand new password 2';
  await arm();

  const ask = await auth.confirmReset({ email: id, token, password: NEW });
  assert.equal(ask.status, 401);
  assert.equal(ask.need2fa, true);
  assert.equal((await auth.confirmReset({ email: id, token, password: NEW, code: wrongOf(code(secret)) })).status, 401);
  // Nothing changed and the link still works.
  assert.ok((await login(id, { code: code(secret) })).ok, 'old password still valid');
  tick();
  const done = await auth.confirmReset({ email: id, token, password: NEW, code: code(secret) });
  assert.ok(done.ok, JSON.stringify(done));
  assert.equal((await auth.confirmReset({ email: id, token, password: NEW, code: code(secret, totp.stepOf() + 1) })).status, 400, 'the link is used up');
  tick();
  assert.equal((await auth.login({ email: id, password: PW, code: code(secret) })).status, 401);
  assert.ok((await auth.login({ email: id, password: NEW, code: code(secret) })).ok);

  // A recovery code also does it.
  tick();
  await arm();
  assert.ok((await auth.confirmReset({ email: id, token, password: PW, code: codes[0] })).ok);
});

test('the sign-in route: asking for a code is free, wrong codes lock the account for every address', async () => {
  const { id, secret } = await withTwofa('route');
  const post = (body, ip) => call(loginRoute.POST, '/api/auth/login', { body: { email: id, password: PW, ...body }, ip });

  for (let i = 0; i < 10; i += 1) {
    const r = await post({}, '10.1.1.1');
    assert.equal(r.status, 401, 'asking for the code never counts toward the lockout');
    assert.equal(r.body.need2fa, true);
    assert.equal(r.body.field, 'code');
  }
  const ok = await post({ code: code(secret) }, '10.1.1.1');
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.ok((ok.headers.get('set-cookie') || '').includes(`${auth.COOKIE}=`));
  tick();

  for (let i = 0; i < 8; i += 1) {
    const r = await post({ code: wrongOf(code(secret)) }, `10.2.2.${i}`); // a different address each time
    assert.equal(r.status, 401, `wrong code ${i + 1}`);
    assert.equal(r.body.field, 'code');
  }
  const locked = await post({ code: code(secret) }, '10.3.3.3'); // the right code, from a new address
  assert.equal(locked.status, 429);
});

test('the two-factor route: needs a real session, and wrong codes lock it', async () => {
  const id = await account('tfroute');
  const cookie = await cookieOf(id);
  const post = (body, c = cookie) => call(twofaRoute.POST, '/api/auth/2fa', { cookie: c, body });

  assert.equal((await call(twofaRoute.POST, '/api/auth/2fa', { body: { action: 'start' } })).status, 403, 'the demo account cannot');
  assert.equal((await post({ action: 'nope' })).status, 400);
  assert.equal((await post({})).status, 400);

  const s = await post({ action: 'start' });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.equal(s.headers.get('cache-control'), 'no-store');
  assert.match(s.body.secret, /^[A-Z2-7]{32}$/);

  for (let i = 0; i < 8; i += 1) {
    const r = await post({ action: 'enable', code: wrongOf(code(s.body.secret)) });
    assert.equal(r.status, 422, `wrong code ${i + 1}`);
  }
  assert.equal((await post({ action: 'enable', code: code(s.body.secret) })).status, 429);
  assert.equal((await auth.whoami(id)).twofa, false);

  // Another account is not affected, and the whole path works through the route.
  const other = await account('tfroute-ok');
  const oc = await cookieOf(other);
  const os = await post({ action: 'start' }, oc);
  const en = await post({ action: 'enable', code: code(os.body.secret) }, oc);
  assert.equal(en.status, 200, JSON.stringify(en.body));
  assert.equal(en.body.codes.length, 10);
  assert.equal((await auth.whoami(other)).twofa, true);
  tick();
  const off = await post({ action: 'disable', password: PW, code: code(os.body.secret) }, oc);
  assert.equal(off.status, 200, JSON.stringify(off.body));
  assert.equal((await auth.whoami(other)).twofa, false);
});

test('the reset route: no code is asked for on accounts without two-factor, and asking is not a failed attempt', async () => {
  const plain = await account('rplain');
  const token = `plain-token-${run}`;
  await withUser(plain, (u) => {
    u.reset = { h: sha(token), exp: Date.now() + 60_000, at: Date.now() };
  });
  const r = await call(confirmRoute.POST, '/api/auth/reset/confirm', { body: { email: plain, token, password: 'another long password 3' }, ip: '10.4.4.4' });
  assert.equal(r.status, 200, JSON.stringify(r.body));

  const { id, secret } = await withTwofa('rtf');
  const t2 = `tf-token-${run}`;
  await withUser(id, (u) => {
    u.reset = { h: sha(t2), exp: Date.now() + 60_000, at: Date.now() };
  });
  for (let i = 0; i < 10; i += 1) {
    const a = await call(confirmRoute.POST, '/api/auth/reset/confirm', { body: { email: id, token: t2, password: 'yet another password 4' }, ip: '10.5.5.5' });
    assert.equal(a.status, 401, 'asking for the code never locks the address');
    assert.equal(a.body.need2fa, true);
  }
  const ok = await call(confirmRoute.POST, '/api/auth/reset/confirm', { body: { email: id, token: t2, password: 'yet another password 4', code: code(secret) }, ip: '10.5.5.5' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
});
