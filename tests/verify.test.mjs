// Email verification against a real Postgres. The mail provider is replaced by a stub that records what would be sent.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.RESEND_API_KEY = 're_test';
process.env.MAIL_FROM = 'Opus <no-reply@test.dev>';

const { pool } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');

const run = `v${Date.now().toString(36)}`;
const email = (n) => `${n}-${run}@test.dev`;
const PW = 'correct horse 1';
const BASE = 'https://app.test';

const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://api.resend.com/')) {
    sent.push(JSON.parse(init.body));
    return new Response('{}', { status: 200 });
  }
  return realFetch(url, init);
};
const tokenFrom = (mail) => /token=([\w-]+)&email=/.exec(mail.text)[1];

before(async () => {
  await migrate();
});

after(async () => {
  globalThis.fetch = realFetch;
  await pool().end();
});

test('a verification link confirms the email once', async () => {
  const e = email('ok');
  assert.ok((await auth.signup({ email: e, password: PW })).ok);
  assert.equal((await auth.whoami(e)).verified, false);

  const r = await auth.sendVerification(e, BASE);
  assert.ok(r.ok);
  const mail = sent.at(-1);
  assert.deepEqual(mail.to, [e]);
  assert.ok(mail.text.includes(`${BASE}/verify?token=`));
  const token = tokenFrom(mail);

  const bad = await auth.confirmVerify({ email: e, token: 'wrong' });
  assert.equal(bad.ok, false);
  assert.equal(bad.status, 400);
  assert.equal((await auth.whoami(e)).verified, false);

  assert.ok((await auth.confirmVerify({ email: e, token })).ok);
  assert.equal((await auth.whoami(e)).verified, true);
  assert.equal((await auth.confirmVerify({ email: e, token })).status, 400, 'a used link does not work again');

  const before = sent.length;
  const again = await auth.sendVerification(e, BASE);
  assert.ok(again.ok && again.verified);
  assert.equal(sent.length, before, 'no mail for an already verified address');
});

test('asking again within a minute is refused, and a link works for its own account only', async () => {
  const a = email('a');
  const b = email('b');
  assert.ok((await auth.signup({ email: a, password: PW })).ok);
  assert.ok((await auth.signup({ email: b, password: PW })).ok);
  assert.ok((await auth.sendVerification(a, BASE)).ok);
  const tokenA = tokenFrom(sent.at(-1));
  assert.equal((await auth.sendVerification(a, BASE)).status, 429);
  assert.ok((await auth.sendVerification(b, BASE)).ok);

  assert.equal((await auth.confirmVerify({ email: b, token: tokenA })).status, 400, 'a link for one account does not verify another');
  assert.equal((await auth.whoami(b)).verified, false);
});

test('the same link used many times at once confirms once', async () => {
  const e = email('race');
  assert.ok((await auth.signup({ email: e, password: PW })).ok);
  assert.ok((await auth.sendVerification(e, BASE)).ok);
  const token = tokenFrom(sent.at(-1));
  const rs = await Promise.all(Array.from({ length: 6 }, () => auth.confirmVerify({ email: e, token })));
  assert.equal(rs.filter((r) => r.ok).length, 1);
  assert.equal((await auth.whoami(e)).verified, true);
});

test('accounts without an email address cannot be sent a link', async () => {
  assert.equal((await auth.sendVerification('demo', BASE)).status, 403);
  assert.equal((await auth.sendVerification('tg:123', BASE)).status, 403);
});
