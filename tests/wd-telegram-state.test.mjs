// The state the Wallet screen asks while it waits for the Accept tap (lib/server/wallet.js tgCodeState).
// 'none' (no code waiting) -> 'wait' (code sent) -> 'approved' (Accept) -> 'none' (used). Asking never sends a code or changes anything.
// Against a real Postgres; the bot is faked.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, tx, withUser, createUser, getUser } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const { withdraw, tgCodeState, tgCodeAnswer } = await import('@/lib/server/wallet');

const ADDR = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
const realFetch = globalThis.fetch;
const was = { url: process.env.BOT_URL, secret: process.env.APP_BOT_SECRET };
let sends = 0;
let seq = 0;

const ask = (id, extra = {}) => withdraw({ asset: 'btc', net: 'btc', amount: 0.001, address: ADDR, ...extra }, { userId: id, key: `s${Date.now()}${Math.random()}` });
const stateOf = async (id) => (await tgCodeState(id)).state;

async function tgAccount() {
  const id = `tg:${9500000 + ((Date.now() + seq++) % 400000)}`;
  await tx((c) => createUser(c, id));
  await withUser(id, (u) => {
    u.withdrawn = -0.05;
  });
  return id;
}

before(async () => {
  await migrate();
  process.env.BOT_URL = 'https://bot.test/';
  process.env.APP_BOT_SECRET = 'k'.repeat(32);
  globalThis.fetch = async () => {
    sends += 1;
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

test('state goes none, wait, approved, none (used)', async () => {
  const id = await tgAccount();
  assert.equal(await stateOf(id), 'none');
  assert.equal((await ask(id)).ok, false);
  assert.equal(await stateOf(id), 'wait');
  const { at } = (await getUser(id)).wdTg;
  assert.equal((await tgCodeAnswer(id, 'accept', at)).status, 200);
  assert.equal(await stateOf(id), 'approved');
  assert.ok((await ask(id)).ok, 'the withdrawal passes with nothing typed');
  assert.equal(await stateOf(id), 'none');
});

test('asking the state sends no message and changes nothing', async () => {
  const id = await tgAccount();
  await ask(id);
  const wdTg = JSON.stringify((await getUser(id)).wdTg);
  await new Promise((r) => setTimeout(r, 50));
  const before = sends;
  for (let i = 0; i < 5; i += 1) await tgCodeState(id);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(sends, before, 'no message');
  assert.equal(JSON.stringify((await getUser(id)).wdTg), wdTg, 'same code record');
});

test('Deny and an expired code both give none', async () => {
  const id = await tgAccount();
  await ask(id);
  const { at } = (await getUser(id)).wdTg;
  await tgCodeAnswer(id, 'deny', at);
  assert.equal(await stateOf(id), 'none');
  await ask(id);
  await withUser(id, (u) => {
    u.wdTg.exp = Date.now() - 1;
  });
  assert.equal(await stateOf(id), 'none');
});

test('an account with no code, and a missing account, give none', async () => {
  assert.equal(await stateOf(await tgAccount()), 'none');
  assert.equal(await stateOf('tg:1'), 'none');
});
