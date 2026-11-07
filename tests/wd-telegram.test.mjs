// Withdrawals for an account with no two-factor and no verified email: a 6-digit code goes to its linked Telegram chat through the bot.
// The code is never saved as a notification, works once, ends after 5 wrong tries, is re-sent at most once a minute and lasts 10 minutes.
// Accounts with a verified email or two-factor, accounts with no Telegram chat and a switched-off bot are unchanged. Against a real Postgres; the bot is faked.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { verifySig } from '../bot/src/notify.js';

const { pool, q, tx, withUser, createUser, getUser } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const { withdraw } = await import('@/lib/server/wallet');

const SECRET = 'k'.repeat(32);
const ADDR = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
const ASKED = 'We sent a code to your Telegram. Enter it to withdraw.';
const realFetch = globalThis.fetch;
const was = { url: process.env.BOT_URL, secret: process.env.APP_BOT_SECRET };
const sent = [];
let seq = 0;

const until = async (f) => {
  for (let i = 0; i < 100 && !f(); i += 1) await new Promise((r) => setTimeout(r, 20));
};
const quiet = () => new Promise((r) => setTimeout(r, 150));
const wrongOf = (c) => c.slice(0, 5) + String((Number(c[5]) + 1) % 10);
const rows = async (id) => (await q('SELECT count(*)::int AS n FROM withdrawals WHERE user_id = $1', [id])).rows[0].n;
const ask = (id, extra = {}) => withdraw({ asset: 'btc', net: 'btc', amount: 0.001, address: ADDR, ...extra }, { userId: id, key: `k${Date.now()}${Math.random()}` });

// A Telegram account with a test balance (a negative u.withdrawn adds balance).
async function tgAccount(extra = {}) {
  const id = `tg:${8000000 + ((Date.now() + seq++) % 1000000)}`;
  await tx((c) => createUser(c, id));
  await withUser(id, (u) => {
    u.withdrawn = -0.05;
    Object.assign(u, extra);
  });
  return id;
}

// An email account, linked to a Telegram chat or not.
async function mailAccount(extra = {}) {
  const id = `m${Date.now()}${seq++}@test.dev`;
  await tx((c) => createUser(c, id));
  await withUser(id, (u) => {
    u.withdrawn = -0.05;
    Object.assign(u, extra);
  });
  return id;
}

// Asks once with no code and returns the code the bot was told to send.
async function codeFor(id) {
  const before = sent.length;
  const r = await ask(id);
  assert.equal(r.ok, false);
  await until(() => sent.length > before);
  assert.equal(sent.length, before + 1, 'one message');
  return sent[sent.length - 1].vars.code;
}

before(async () => {
  await migrate();
  process.env.BOT_URL = 'https://bot.test/';
  process.env.APP_BOT_SECRET = SECRET;
  globalThis.fetch = async (url, init) => {
    const body = verifySig(init.body, init.headers['x-app-sig'], SECRET);
    if (body) sent.push(body);
    return { ok: true, status: 200 };
  };
});
after(async () => {
  globalThis.fetch = realFetch;
  for (const [k, v] of [['BOT_URL', was.url], ['APP_BOT_SECRET', was.secret]]) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await pool().end();
});

test('no code: a code goes to Telegram, nothing is taken and the code is not saved anywhere readable', async () => {
  const id = await tgAccount();
  sent.length = 0;
  const r = await ask(id);
  assert.equal(r.ok, false);
  assert.equal(r.need2fa, true);
  assert.equal(r.via, 'telegram');
  assert.equal(r.field, 'code');
  assert.equal(r.error, ASKED);
  await until(() => sent.length >= 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, 'wdCode');
  assert.equal(sent[0].tg_id, Number(id.slice(3)));
  assert.match(sent[0].vars.code, /^\d{6}$/);
  assert.equal(await rows(id), 0);
  const u = await getUser(id);
  assert.equal(u.withdrawn, -0.05, 'balance untouched');
  assert.equal(JSON.stringify(u.notifications).includes(sent[0].vars.code), false, 'not a notification');
  assert.notEqual(u.wdTg.h, sent[0].vars.code, 'only a hash is stored');
});

test('a wrong code is refused; the right code works once and a used code asks for a new one', async () => {
  const id = await tgAccount();
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
  await until(() => sent.length >= 2);
  assert.equal(sent.length, 2);
  assert.equal(await rows(id), 1);
});

test('a failed withdrawal for another reason does not use the code up', async () => {
  const id = await tgAccount();
  sent.length = 0;
  const c = await codeFor(id);
  assert.equal((await ask(id, { code: c, amount: 100 })).ok, false); // more than the balance
  assert.ok((await ask(id, { code: c })).ok, 'the same code still works');
});

test('five wrong tries end the code', async () => {
  const id = await tgAccount();
  sent.length = 0;
  const c = await codeFor(id);
  const bad = wrongOf(c);
  for (let i = 0; i < 4; i += 1) assert.equal((await ask(id, { code: bad })).status, 422);
  const last = await ask(id, { code: bad });
  assert.equal(last.status, 429);
  assert.equal(last.error, 'Too many wrong codes. Ask for a new one.');
  assert.equal((await getUser(id)).wdTg, undefined);
  const next = await ask(id, { code: c });
  assert.equal(next.ok, false, 'the old code no longer works');
  assert.equal(next.need2fa, true, 'a new code is sent');
  assert.equal(await rows(id), 0);
});

test('a new code is sent at most once a minute', async () => {
  const id = await tgAccount();
  sent.length = 0;
  await codeFor(id);
  const again = await ask(id);
  assert.equal(again.need2fa, true);
  assert.equal(again.error, ASKED);
  await quiet();
  assert.equal(sent.length, 1, 'no second message within a minute');
  await withUser(id, (u) => {
    u.wdTg.at -= 61_000;
  });
  await ask(id);
  await until(() => sent.length >= 2);
  assert.equal(sent.length, 2, 'after a minute a new one goes out');
});

test('an expired code asks for a new one', async () => {
  const id = await tgAccount();
  sent.length = 0;
  const c = await codeFor(id);
  await withUser(id, (u) => {
    u.wdTg.exp = Date.now() - 1;
    u.wdTg.at -= 61_000;
  });
  const r = await ask(id, { code: c });
  assert.equal(r.ok, false);
  assert.equal(r.need2fa, true);
  await until(() => sent.length >= 2);
  assert.equal(sent.length, 2);
  assert.equal(await rows(id), 0);
});

test('an email account linked to Telegram is asked too; an unlinked one is not', async () => {
  const linked = await mailAccount({ botTg: 424242 });
  sent.length = 0;
  const r = await ask(linked);
  assert.equal(r.need2fa, true);
  await until(() => sent.length >= 1);
  assert.equal(sent[0].tg_id, 424242);
  const plain = await mailAccount();
  sent.length = 0;
  assert.ok((await ask(plain)).ok);
  await quiet();
  assert.equal(sent.length, 0);
});

test('a verified email, two-factor or a switched-off bot leave the withdrawal as it was', async () => {
  const verified = await tgAccount({ emailVerified: Date.now() });
  sent.length = 0;
  assert.ok((await ask(verified)).ok, 'verified email: no Telegram code');

  const tf = await tgAccount({ twofa: { secret: 'x' } });
  const none = await ask(tf);
  assert.equal(none.need2fa, true);
  assert.equal(none.error, 'Enter your two-factor code to withdraw.', 'two-factor keeps its own step');

  const off = await tgAccount();
  delete process.env.BOT_URL;
  try {
    assert.ok((await ask(off)).ok, 'bot off: nothing to send, nothing blocked');
  } finally {
    process.env.BOT_URL = 'https://bot.test/';
  }
  await quiet();
  assert.equal(sent.length, 0);
});
