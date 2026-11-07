// Withdrawals for an account with a verified email and no two-factor: a 6-digit code goes to that email and has to be typed in.
// It works once, ends after 5 wrong tries, is re-sent at most once a minute and lasts 10 minutes. The mail goes out after the commit;
// if it cannot be sent the code is dropped. Accounts with no verified email, two-factor, or email sending switched off are unchanged.
// Against a real Postgres; the mail provider is faked.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, q, tx, withUser, createUser, getUser } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const { withdraw } = await import('@/lib/server/wallet');

const ADDR = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
const ASKED = 'We sent a code to your email. Enter it to withdraw.';
const realFetch = globalThis.fetch;
const was = { key: process.env.RESEND_API_KEY, from: process.env.MAIL_FROM };
const sent = [];
let mailOk = true;
let seq = 0;

const wrongOf = (c) => c.slice(0, 5) + String((Number(c[5]) + 1) % 10);
const rows = async (id) => (await q('SELECT count(*)::int AS n FROM withdrawals WHERE user_id = $1', [id])).rows[0].n;
const ask = (id, extra = {}) => withdraw({ asset: 'btc', net: 'btc', amount: 0.001, address: ADDR, ...extra }, { userId: id, key: `k${Date.now()}${Math.random()}` });

// An email account with a test balance (a negative u.withdrawn adds balance).
async function mailAccount(extra = {}) {
  const id = `w${Date.now()}${seq++}@test.dev`;
  await tx((c) => createUser(c, id));
  await withUser(id, (u) => {
    u.withdrawn = -0.05;
    u.email = id;
    u.emailVerified = Date.now();
    Object.assign(u, extra);
  });
  return id;
}

// Asks once with no code and returns the code that was mailed.
async function codeFor(id) {
  const before = sent.length;
  const r = await ask(id);
  assert.equal(r.ok, false);
  assert.equal(sent.length, before + 1, 'one mail');
  return sent[sent.length - 1].code;
}

before(async () => {
  await migrate();
  process.env.RESEND_API_KEY = 're_test';
  process.env.MAIL_FROM = 'Vertexhash <no-reply@test.dev>';
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://api.resend.com/')) {
      const body = JSON.parse(init.body);
      if (!mailOk) return { ok: false, status: 500 };
      sent.push({ to: body.to[0], subject: body.subject, text: body.text, code: (body.text.match(/\b(\d{6})\b/) || [])[1] });
    }
    return { ok: true, status: 200 };
  };
});
after(async () => {
  globalThis.fetch = realFetch;
  for (const [k, v] of [['RESEND_API_KEY', was.key], ['MAIL_FROM', was.from]]) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await pool().end();
});

test('no code: a code is mailed, nothing is taken and only a hash is stored', async () => {
  const id = await mailAccount();
  sent.length = 0;
  const r = await ask(id);
  assert.equal(r.ok, false);
  assert.equal(r.need2fa, true);
  assert.equal(r.via, 'email');
  assert.equal(r.field, 'code');
  assert.equal(r.error, ASKED);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, id);
  assert.match(sent[0].code, /^\d{6}$/);
  assert.equal(await rows(id), 0);
  const u = await getUser(id);
  assert.equal(u.withdrawn, -0.05, 'balance untouched');
  assert.equal(JSON.stringify(u.notifications).includes(sent[0].code), false, 'not a notification');
  assert.notEqual(u.wdMail.h, sent[0].code, 'only a hash is stored');
});

test('a wrong code is refused; the right code works once and a used code asks for a new one', async () => {
  const id = await mailAccount();
  sent.length = 0;
  const c = await codeFor(id);
  const bad = await ask(id, { code: wrongOf(c) });
  assert.equal(bad.ok, false);
  assert.equal(bad.error, 'That code is wrong. Try again.');
  assert.equal(bad.need2fa, undefined);
  assert.equal(await rows(id), 0);
  assert.ok((await ask(id, { code: c })).ok);
  assert.equal(await rows(id), 1);
  const again = await ask(id, { code: c });
  assert.equal(again.ok, false);
  assert.equal(again.need2fa, true, 'the used code is gone: a new one is sent');
  assert.equal(sent.length, 2);
  assert.equal(await rows(id), 1);
});

test('a failed withdrawal for another reason does not use the code up', async () => {
  const id = await mailAccount();
  sent.length = 0;
  const c = await codeFor(id);
  assert.equal((await ask(id, { code: c, amount: 100 })).ok, false); // more than the balance
  assert.ok((await ask(id, { code: c })).ok, 'the same code still works');
});

test('five wrong tries end the code', async () => {
  const id = await mailAccount();
  sent.length = 0;
  const c = await codeFor(id);
  const bad = wrongOf(c);
  for (let i = 0; i < 4; i += 1) assert.equal((await ask(id, { code: bad })).status, 422);
  const last = await ask(id, { code: bad });
  assert.equal(last.status, 429);
  assert.equal(last.error, 'Too many wrong codes. Ask for a new one.');
  assert.equal((await getUser(id)).wdMail, undefined);
  const next = await ask(id, { code: c });
  assert.equal(next.ok, false, 'the old code no longer works');
  assert.equal(next.need2fa, true, 'a new code is sent');
  assert.equal(await rows(id), 0);
});

test('a new code is mailed at most once a minute', async () => {
  const id = await mailAccount();
  sent.length = 0;
  await codeFor(id);
  const again = await ask(id);
  assert.equal(again.need2fa, true);
  assert.equal(again.error, ASKED);
  assert.equal(sent.length, 1, 'no second mail within a minute');
  await withUser(id, (u) => {
    u.wdMail.at -= 61_000;
  });
  await ask(id);
  assert.equal(sent.length, 2, 'after a minute a new one goes out');
});

test('an expired code asks for a new one', async () => {
  const id = await mailAccount();
  sent.length = 0;
  const c = await codeFor(id);
  await withUser(id, (u) => {
    u.wdMail.exp = Date.now() - 1;
    u.wdMail.at -= 61_000;
  });
  const r = await ask(id, { code: c });
  assert.equal(r.ok, false);
  assert.equal(r.need2fa, true);
  assert.equal(sent.length, 2);
  assert.equal(await rows(id), 0);
});

test('if the mail cannot be sent the code is dropped and the next try makes a fresh one', async () => {
  const id = await mailAccount();
  sent.length = 0;
  mailOk = false;
  try {
    const r = await ask(id);
    assert.equal(r.ok, false);
    assert.equal(r.status, 502);
    assert.equal(r.error, 'Could not send the email. Try again later.');
    assert.equal((await getUser(id)).wdMail, undefined);
  } finally {
    mailOk = true;
  }
  const c = await codeFor(id);
  assert.match(c, /^\d{6}$/);
});

test('no verified email, two-factor or email sending switched off leave the withdrawal as it was', async () => {
  const unverified = await mailAccount({ emailVerified: undefined });
  sent.length = 0;
  assert.ok((await ask(unverified)).ok, 'unverified email: no code');

  const tf = await mailAccount({ twofa: { secret: 'x' } });
  const none = await ask(tf);
  assert.equal(none.need2fa, true);
  assert.equal(none.error, 'Enter your two-factor code to withdraw.', 'two-factor keeps its own step');

  const off = await mailAccount();
  delete process.env.RESEND_API_KEY;
  try {
    assert.ok((await ask(off)).ok, 'email off: nothing to send, nothing blocked');
  } finally {
    process.env.RESEND_API_KEY = 're_test';
  }
  assert.equal(sent.length, 0);
});
