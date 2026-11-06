import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { migrate } from '../src/migrate.js';
import { q, closeDb } from '../src/db.js';
import { makeBot } from '../src/app.js';
import { makeQueue } from '../src/queue.js';
import { signBody } from '../src/notify.js';

const SECRET = 'b'.repeat(32);
const cfg = {
  token: '12345:' + 'a'.repeat(30),
  path: 'p'.repeat(20),
  secret: 's'.repeat(20),
  appUrl: 'https://vertexhash.com',
  supportEmail: 'support@vertexhash.com',
  chatLimitPerMin: 50,
  notifySecret: SECRET,
  notifyPerSec: 25,
  broadcastPerSec: 10,
};
const sent = [];
const sleeps = [];
const tg = {
  sendMessage: async (chat, text, extra = {}) => {
    sent.push({ chat, text, extra });
    return { ok: true, status: 200 };
  },
};
const mkQueue = () => makeQueue({ tg, config: cfg, sleep: async (ms) => void sleeps.push(ms) });
const bot = makeBot({ config: cfg, tg, queue: mkQueue() });
let server;
let base;
let n = 0;
let upd = 1;

const body = (o = {}) => ({ id: `bc-test-${n++}-abcd`, en: 'Hello news', sent_at: new Date().toISOString(), ...o });
const post = (b, sig) => fetch(`${base}/broadcast`, { method: 'POST', headers: { 'content-type': 'application/json', ...(sig ? { 'x-app-sig': sig } : {}) }, body: JSON.stringify(b) });
const send = (b, secret = SECRET) => post(b, signBody(b, secret));
const rows = async () => (await q('SELECT dedupe_key, status, kind, last_error FROM notify_outbox ORDER BY id')).rows;
const msg = (text, id = 7001) => ({ update_id: upd++, message: { chat: { id, type: 'private' }, from: { id, is_bot: false, language_code: 'en' }, text } });

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
  sleeps.length = 0;
  await q('TRUNCATE chats, processed_updates, notify_outbox');
});
after(async () => {
  await new Promise((r) => server.close(r));
  await closeDb();
});

test('a missing, wrong or old signature gets 401 and nothing is queued', async () => {
  await q("INSERT INTO chats (tg_id) VALUES (7001)");
  const b = body();
  assert.equal((await post(b)).status, 401);
  assert.equal((await send(b, 'x'.repeat(32))).status, 401);
  assert.equal((await send(body({ sent_at: new Date(Date.now() - 30 * 60_000).toISOString() }))).status, 401);
  assert.equal((await rows()).length, 0);
});

test('bad fields are refused with 400', async () => {
  assert.equal((await send(body({ id: 'short' }))).status, 400);
  assert.equal((await send(body({ en: '   ' }))).status, 400);
  assert.equal((await send(body({ en: 'x'.repeat(1001) }))).status, 400);
  assert.equal((await send(body({ fa: 'y'.repeat(1001) }))).status, 400);
  assert.equal((await send(body({ test_tg_id: -4 }))).status, 400);
  assert.equal((await rows()).length, 0);
});

test('all: one row per active chat with news on; the same id again adds nothing', async () => {
  await q("INSERT INTO chats (tg_id, active, news) VALUES (7001, true, true), (7002, true, true), (7003, false, true), (7004, true, false)");
  const b = body();
  const r1 = await send(b);
  assert.deepEqual(await r1.json(), { ok: true, queued: 2 });
  const r2 = await send({ ...b, sent_at: new Date().toISOString() });
  assert.deepEqual(await r2.json(), { ok: true, queued: 0 });
  assert.equal((await rows()).length, 2);
});

test('test: one row for that chat, even when it did /stop; sent in its language with a fallback to en', async () => {
  await q("INSERT INTO chats (tg_id, lang, news) VALUES (7001, 'fa', false)");
  const r = await send(body({ en: 'English text', fa: 'متن فارسی', test_tg_id: 7001 }));
  assert.deepEqual(await r.json(), { ok: true, queued: 1 });
  assert.equal((await mkQueue().deliverDue()).sent, 1);
  assert.equal(sent[0].text, 'متن فارسی');
  await q("TRUNCATE notify_outbox");
  sent.length = 0;
  await send(body({ en: 'English only', test_tg_id: 7001 }));
  await mkQueue().deliverDue();
  assert.equal(sent[0].text, 'English only');
});

test('a chat that sends /stop after the broadcast was queued is skipped', async () => {
  await q("INSERT INTO chats (tg_id) VALUES (7001), (7002)");
  await send(body());
  await q('UPDATE chats SET news = false WHERE tg_id = 7002');
  const out = await mkQueue().deliverDue();
  assert.equal(out.sent, 1);
  assert.equal(out.skipped, 1);
  assert.equal(Number(sent[0].chat), 7001);
  assert.ok((await rows()).some((r) => r.last_error === 'news off'));
});

test('money notices go before broadcast rows, and broadcasts are paced slower', async () => {
  await q("INSERT INTO chats (tg_id) VALUES (7001), (7002), (7003)");
  await send(body());
  await q("INSERT INTO notify_outbox (dedupe_key, tg_id, kind, vars) VALUES ('money-late-0001', 7003, 'depPaid', '{\"usd\":\"5.00\"}')");
  await mkQueue().deliverDue();
  assert.equal(sent.length, 4);
  assert.equal(sent[0].text, 'Deposit received: $5.00.');
  assert.ok(sleeps.includes(100), 'broadcast gap is 100 ms');
});

test('/broadcast is off (404) without APP_BOT_SECRET', async () => {
  const off = makeBot({ config: { ...cfg, notifySecret: '' }, tg });
  const s = createServer((req, res) => off.handler(req, res));
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const r = await fetch(`http://127.0.0.1:${s.address().port}/broadcast`, { method: 'POST', body: '{}' });
  assert.equal(r.status, 404);
  await new Promise((r2) => s.close(r2));
});

test('/stop turns news off, /start turns it on and says so only then', async () => {
  await bot.handleUpdate(msg('/stop'));
  assert.equal((await q('SELECT news FROM chats WHERE tg_id = 7001')).rows[0].news, false);
  assert.ok(sent[0].text.includes('News turned off'));
  await bot.handleUpdate(msg('/start'));
  assert.equal((await q('SELECT news FROM chats WHERE tg_id = 7001')).rows[0].news, true);
  assert.ok(sent[1].text.includes('News turned on'));
  await bot.handleUpdate(msg('/start'));
  assert.ok(!sent[2].text.includes('News turned on'));
});
