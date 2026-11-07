// The Accept and Deny buttons under the Telegram withdrawal code (lib/server/wallet.js tgCodeAnswer, lib/server/botapi.js wdCodeFor).
// Accept = the same as typing the right code (once, nothing typed); Deny ends the code and leaves a notice. Only the code sent last counts.
// Against a real Postgres; the bot is faked.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { verifySig } from '../bot/src/notify.js';

const { pool, q, tx, withUser, createUser, getUser } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const { withdraw } = await import('@/lib/server/wallet');
const { wdCodeFor, serve } = await import('@/lib/server/botapi');
const { signBody } = await import('@/lib/server/botnotify');

const SECRET = 'k'.repeat(32);
const ADDR = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
const realFetch = globalThis.fetch;
const was = { url: process.env.BOT_URL, secret: process.env.APP_BOT_SECRET };
const sent = [];
let seq = 0;

const until = async (f) => {
  for (let i = 0; i < 100 && !f(); i += 1) await new Promise((r) => setTimeout(r, 20));
};
const rows = async (id) => (await q('SELECT count(*)::int AS n FROM withdrawals WHERE user_id = $1', [id])).rows[0].n;
const ask = (id, extra = {}) => withdraw({ asset: 'btc', net: 'btc', amount: 0.001, address: ADDR, ...extra }, { userId: id, key: `k${Date.now()}${Math.random()}` });
const tgOf = (id) => Number(id.slice(3));
const press = (id, act, ref) => wdCodeFor({ tg_id: tgOf(id), act, ref, sent_at: new Date().toISOString() });

async function tgAccount() {
  const id = `tg:${9000000 + ((Date.now() + seq++) % 900000)}`;
  await tx((c) => createUser(c, id));
  await withUser(id, (u) => {
    u.withdrawn = -0.05;
  });
  return id;
}

// Asks once with no code; returns the code message the bot was told to send ({ code, ref }).
async function codeFor(id) {
  const before = sent.length;
  const r = await ask(id);
  assert.equal(r.ok, false);
  await until(() => sent.length > before);
  assert.equal(sent.length, before + 1, 'one message');
  return sent[sent.length - 1].vars;
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

test('the code message carries the time of the code (ref) for the buttons', async () => {
  const id = await tgAccount();
  sent.length = 0;
  const v = await codeFor(id);
  assert.match(v.code, /^\d{6}$/);
  assert.equal(v.ref, (await getUser(id)).wdTg.at);
});

test('Accept: the next withdrawal goes through with no code typed, once', async () => {
  const id = await tgAccount();
  sent.length = 0;
  const { ref } = await codeFor(id);
  const r = await press(id, 'accept', ref);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true });
  assert.equal(await rows(id), 0, 'Accept only approves: nothing is withdrawn by the button');
  assert.ok((await ask(id)).ok, 'the withdrawal passes');
  assert.equal(await rows(id), 1);
  const again = await ask(id);
  assert.equal(again.ok, false, 'used up');
  assert.equal(again.need2fa, true, 'a new code is asked for');
});

test('Accept: a withdrawal that fails for another reason does not use the approval up', async () => {
  const id = await tgAccount();
  sent.length = 0;
  const { ref } = await codeFor(id);
  await press(id, 'accept', ref);
  assert.equal((await ask(id, { amount: 100 })).ok, false); // more than the balance
  assert.ok((await ask(id)).ok, 'still approved');
});

test('Accept: a wrong or old ref, an expired code and a used code change nothing', async () => {
  const id = await tgAccount();
  sent.length = 0;
  const { ref } = await codeFor(id);
  assert.equal((await press(id, 'accept', ref + 1)).status, 404);
  assert.equal((await ask(id)).ok, false, 'not approved');
  await withUser(id, (u) => {
    u.wdTg.exp = Date.now() - 1;
  });
  assert.equal((await press(id, 'accept', ref)).status, 404, 'expired');
  await withUser(id, (u) => {
    u.wdTg.exp = Date.now() + 60_000;
  });
  assert.equal((await press(id, 'accept', ref)).status, 200);
  assert.ok((await ask(id)).ok);
  assert.equal((await press(id, 'accept', ref)).status, 404, 'used');
  assert.equal(await rows(id), 1);
});

test('Accept: an old message does not work after a new code was sent', async () => {
  const id = await tgAccount();
  sent.length = 0;
  const first = await codeFor(id);
  await withUser(id, (u) => {
    u.wdTg.at -= 61_000;
  });
  const second = await codeFor(id);
  assert.notEqual(first.ref, second.ref);
  assert.equal((await press(id, 'accept', first.ref)).status, 404);
  assert.equal((await press(id, 'accept', second.ref)).status, 200);
});

test('Deny: the code ends, the typed code no longer works, a notice is saved and nothing is withdrawn', async () => {
  const id = await tgAccount();
  sent.length = 0;
  const { code, ref } = await codeFor(id);
  const r = await press(id, 'deny', ref);
  assert.equal(r.status, 200);
  const u = await getUser(id);
  assert.equal(u.wdTg, undefined);
  assert.equal(u.notifications[0].code, 'wdDeny');
  assert.equal(JSON.stringify(u.notifications).includes(code), false, 'the code is not in the notice');
  const next = await ask(id, { code });
  assert.equal(next.ok, false, 'the denied code is dead');
  assert.equal(next.need2fa, true, 'a new code is asked for');
  assert.equal(await rows(id), 0);
  assert.equal((await press(id, 'deny', ref)).status, 404, 'pressing again does nothing');
});

test('Deny after Accept cancels the approval', async () => {
  const id = await tgAccount();
  sent.length = 0;
  const { ref } = await codeFor(id);
  await press(id, 'accept', ref);
  assert.equal((await press(id, 'deny', ref)).status, 200);
  assert.equal((await ask(id)).ok, false);
  assert.equal(await rows(id), 0);
});

test('only the account of that Telegram chat is touched; bad calls are refused', async () => {
  const a = await tgAccount();
  const b = await tgAccount();
  sent.length = 0;
  const { ref } = await codeFor(a);
  assert.equal((await wdCodeFor({ tg_id: tgOf(b), act: 'accept', ref })).status, 404, 'another chat has no such code');
  assert.equal((await wdCodeFor({ tg_id: 777000111, act: 'accept', ref })).status, 404, 'no account');
  assert.equal((await wdCodeFor({ tg_id: tgOf(a), act: 'nope', ref })).status, 400);
  assert.equal((await wdCodeFor({ tg_id: tgOf(a), act: 'accept', ref: 'x' })).status, 400);
  assert.equal((await wdCodeFor({ tg_id: -5, act: 'accept', ref })).status, 400);
  assert.equal((await ask(a)).ok, false, 'nothing was approved');
});

test('the route checks the signature', async () => {
  const id = await tgAccount();
  sent.length = 0;
  const { ref } = await codeFor(id);
  const body = { tg_id: tgOf(id), act: 'accept', ref, sent_at: new Date().toISOString() };
  const raw = JSON.stringify(body);
  const env = { APP_BOT_SECRET: SECRET };
  assert.equal((await serve(raw, 'bad', wdCodeFor, { env })).status, 401);
  assert.equal((await serve(raw, signBody(body, SECRET), wdCodeFor, { env: { APP_BOT_SECRET: '' } })).status, 503);
  const ok = await serve(raw, signBody(body, SECRET), wdCodeFor, { env });
  assert.equal(ok.status, 200);
  assert.ok((await ask(id)).ok);
});
