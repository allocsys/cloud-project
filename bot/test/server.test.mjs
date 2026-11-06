import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { migrate } from '../src/migrate.js';
import { q, closeDb } from '../src/db.js';
import { makeBot } from '../src/app.js';

const cfg = {
  token: '12345:' + 'a'.repeat(30),
  path: 'p'.repeat(20),
  secret: 's'.repeat(20),
  appUrl: 'https://vertexhash.com',
  supportEmail: 'support@vertexhash.com',
  chatLimitPerMin: 20,
};
const sent = [];
const tg = {
  sendMessage: async (chat, text, extra = {}) => {
    sent.push({ chat, text, extra });
    return { ok: true, status: 200 };
  },
};
const bot = makeBot({ config: cfg, tg });
let server;
let base;
let n = 100;
const upd = (text = '/start') => ({ update_id: n++, message: { chat: { id: 2002, type: 'private' }, from: { id: 2002, is_bot: false }, text } });
const post = (path, body, headers = {}) =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const HOOK = `/tg/${cfg.path}`;
const GOOD = { 'x-telegram-bot-api-secret-token': cfg.secret };

before(async () => {
  await migrate();
  server = createServer((req, res) => {
    bot.handler(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500).end();
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(async () => {
  sent.length = 0;
  await q('TRUNCATE chats, processed_updates');
});
after(async () => {
  await new Promise((r) => server.close(r));
  await closeDb();
});

test('health answers with the database state', async () => {
  const r = await fetch(`${base}/health`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, service: 'vtx-bot', db: 'ok' });
});

test('a wrong path or a missing or wrong secret header gets 404 and nothing is sent', async () => {
  assert.equal((await post('/tg/wrongwrongwrongwrong', upd(), GOOD)).status, 404);
  assert.equal((await post(HOOK, upd())).status, 404);
  assert.equal((await post(HOOK, upd(), { 'x-telegram-bot-api-secret-token': 'x'.repeat(20) })).status, 404);
  assert.equal((await fetch(base + HOOK)).status, 404);
  await bot.idle();
  assert.equal(sent.length, 0);
});

test('a good update answers 200 and the reply is sent', async () => {
  const r = await post(HOOK, upd('/start'), GOOD);
  assert.equal(r.status, 200);
  await bot.idle();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chat, 2002);
});

test('the same update_id is handled once', async () => {
  const u = upd('/help');
  assert.equal((await post(HOOK, u, GOOD)).status, 200);
  assert.equal((await post(HOOK, u, GOOD)).status, 200);
  await bot.idle();
  assert.equal(sent.length, 1);
});

test('bad bodies are refused', async () => {
  assert.equal((await post(HOOK, 'not json', GOOD)).status, 400);
  assert.equal((await post(HOOK, { hello: 1 }, GOOD)).status, 400);
  assert.equal((await post(HOOK, { update_id: 1, pad: 'x'.repeat(70 * 1024) }, GOOD)).status, 413);
});
