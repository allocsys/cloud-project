// Step 8 hardening: the password reset steps and the capped body reader.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const { pool, q, getUser, withUser } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');
const { readCapped } = await import('@/lib/server/body');

const run = `h${Date.now().toString(36)}`;
const email = (n) => `${n}-${run}@test.dev`;
const PW = 'correct horse 1';
const sha = (s) => createHash('sha256').update(s).digest('hex');
const RESET_FAIL = 400;

before(async () => {
  await migrate();
});

after(async () => {
  await pool().end();
});

test('a reset request answers the same for a known and an unknown email, and changes nothing for the unknown one', async () => {
  process.env.RESEND_API_KEY ||= 'test-key';
  process.env.MAIL_FROM ||= 'noreply@test.dev';
  const known = email('known');
  const unknown = email('unknown');
  assert.ok((await auth.signup({ email: known, password: PW })).ok);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200 }); // no real mail
  try {
    const a = await auth.requestReset({ email: known }, 'http://localhost');
    const b = await auth.requestReset({ email: unknown }, 'http://localhost');
    assert.deepEqual(a, { ok: true, status: 200 });
    assert.deepEqual(b, a);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.ok((await getUser(known)).reset?.h, 'the known account got a reset link');
  assert.equal((await q('SELECT count(*)::int AS n FROM users WHERE id = $1', [unknown])).rows[0].n, 0, 'no account was made for the unknown email');
});

test('a wrong or expired reset link is refused and the right one still works afterwards', async () => {
  const id = email('confirm');
  assert.ok((await auth.signup({ email: id, password: PW })).ok);
  const token = `reset-token-${run}`;
  const arm = (exp) =>
    withUser(id, (u) => {
      u.reset = { h: sha(token), exp, at: Date.now() };
    });
  const NEW = 'a brand new password 3';

  await arm(Date.now() + 60_000);
  assert.equal((await auth.confirmReset({ email: id, token: 'wrong', password: NEW })).status, RESET_FAIL);
  assert.equal((await auth.confirmReset({ email: email('nobody'), token, password: NEW })).status, RESET_FAIL);
  assert.equal((await getUser(id)).reset.h, sha(token), 'a wrong try leaves the link in place');

  await arm(Date.now() - 1000);
  assert.equal((await auth.confirmReset({ email: id, token, password: NEW })).status, RESET_FAIL, 'expired');

  await arm(Date.now() + 60_000);
  assert.ok((await auth.confirmReset({ email: id, token, password: NEW })).ok);
  assert.equal((await auth.confirmReset({ email: id, token, password: NEW })).status, RESET_FAIL, 'the link is used up');
});

test('a short password is refused before anything else', async () => {
  assert.equal((await auth.confirmReset({ email: email('x'), token: 'x', password: 'short' })).status, 422);
});

test('readCapped returns the body, or null once it grows past the limit', async () => {
  const mk = (body) => new Request('http://localhost/x', { method: 'POST', body });
  const small = await readCapped(mk('a'.repeat(1000)), 2000);
  assert.equal(small.length, 1000);
  assert.equal(await readCapped(mk('a'.repeat(1000)), 500), null);
  assert.equal((await readCapped(new Request('http://localhost/x'), 10)).length, 0, 'no body is an empty buffer');

  // A chunked body has no Content-Length: the size is counted while reading.
  const chunks = () =>
    new ReadableStream({
      start(c) {
        for (let i = 0; i < 3; i += 1) c.enqueue(new TextEncoder().encode('b'.repeat(400)));
        c.close();
      },
    });
  const chunked = () => new Request('http://localhost/x', { method: 'POST', body: chunks(), duplex: 'half' });
  assert.equal(chunked().headers.get('content-length'), null);
  assert.equal((await readCapped(chunked(), 1200)).length, 1200);
  assert.equal(await readCapped(chunked(), 1000), null);
});
