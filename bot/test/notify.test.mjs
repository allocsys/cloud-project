import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { migrate } from '../src/migrate.js';
import { q, closeDb } from '../src/db.js';
import { makeBot } from '../src/app.js';
import { makeQueue } from '../src/queue.js';
import { signBody, verifySig } from '../src/notify.js';

const SECRET = 'n'.repeat(32);
const cfg = {
  token: '12345:' + 'a'.repeat(30),
  path: 'p'.repeat(20),
  secret: 's'.repeat(20),
  appUrl: 'https://vertexhash.com',
  supportEmail: 'support@vertexhash.com',
  chatLimitPerMin: 20,
  notifySecret: SECRET,
  notifyPerSec: 25,
};
const sent = [];
let answer = { ok: true, status: 200 };
const tg = {
  sendMessage: async (chat, text, extra = {}) => {
    sent.push({ chat, text, extra });
    return answer;
  },
};
const mkQueue = () => makeQueue({ tg, config: cfg, sleep: async () => {} });
const bot = makeBot({ config: cfg, tg, queue: mkQueue() });
let server;
let base;
let n = 0;

const body = (o = {}) => ({ tg_id: 5001, kind: 'depPaid', key: `n17000000000${n++}abcd`, vars: { usd: '50.00' }, sent_at: new Date().toISOString(), ...o });
const post = (b, sig) => fetch(`${base}/notify`, { method: 'POST', headers: { 'content-type': 'application/json', ...(sig ? { 'x-app-sig': sig } : {}) }, body: JSON.stringify(b) });
const send = (b, secret = SECRET) => post(b, signBody(b, secret));
const rows = async () => (await q('SELECT dedupe_key, status, attempts FROM notify_outbox ORDER BY id')).rows;

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
  answer = { ok: true, status: 200 };
  await q('TRUNCATE chats, processed_updates, notify_outbox');
});
after(async () => {
  await new Promise((r) => server.close(r));
  await closeDb();
});

test('a missing, wrong or old signature gets 401 and nothing is queued', async () => {
  const b = body();
  assert.equal((await post(b)).status, 401);
  assert.equal((await send(b, 'x'.repeat(32))).status, 401);
  assert.equal((await send(body({ sent_at: new Date(Date.now() - 30 * 60_000).toISOString() }))).status, 401);
  const tampered = body();
  const sig = signBody(tampered, SECRET);
  assert.equal((await post({ ...tampered, tg_id: 5002 }, sig)).status, 401);
  assert.equal((await rows()).length, 0);
});

test('bad fields are refused with 400', async () => {
  assert.equal((await send(body({ kind: 'nope' }))).status, 400);
  assert.equal((await send(body({ key: 'short' }))).status, 400);
  assert.equal((await send(body({ tg_id: -1 }))).status, 400);
  assert.equal((await send(body({ lang: 'de' }))).status, 400);
  assert.equal((await send(body({ vars: { a: { b: 1 } } }))).status, 400);
  assert.equal((await rows()).length, 0);
});

test('a good call is queued once; the same key again changes nothing', async () => {
  const b = body();
  const r1 = await send(b);
  assert.equal(r1.status, 200);
  assert.deepEqual(await r1.json(), { ok: true, queued: true });
  const r2 = await send({ ...b, sent_at: new Date().toISOString() });
  assert.deepEqual(await r2.json(), { ok: true, queued: false });
  assert.equal((await rows()).length, 1);
});

test('the app signature and the bot check agree', () => {
  const b = body();
  assert.ok(verifySig(JSON.stringify(b), signBody(b, SECRET), SECRET));
  assert.equal(verifySig(JSON.stringify(b), signBody(b, SECRET), 'other'.repeat(8)), null);
});

test('the queue sends the text with the Open app button, in the chat language', async () => {
  await q("INSERT INTO chats (tg_id, lang) VALUES (5001, 'fa'), (5002, 'en')");
  await send(body({ tg_id: 5001 }));
  await send(body({ tg_id: 5002, kind: 'wdSent', vars: { amt: '0.5 BTC' } }));
  const out = await mkQueue().deliverDue();
  assert.equal(out.sent, 2);
  const fa = sent.find((s) => Number(s.chat) === 5001);
  const en = sent.find((s) => Number(s.chat) === 5002);
  assert.equal(fa.text, 'واریز شد: $50.00.');
  assert.equal(en.text, 'Withdrawal sent: 0.5 BTC.');
  assert.equal(en.extra.reply_markup.inline_keyboard[0][0].web_app.url, cfg.appUrl);
  assert.deepEqual((await rows()).map((r) => r.status), ['sent', 'sent']);
});

test('a blocked chat (403) is marked inactive and later messages to it are skipped', async () => {
  await q("INSERT INTO chats (tg_id, lang) VALUES (5001, 'en')");
  await send(body());
  answer = { ok: false, status: 403, description: 'Forbidden: bot was blocked by the user' };
  const queue = mkQueue();
  assert.equal((await queue.deliverDue()).skipped, 1);
  assert.equal((await q('SELECT active FROM chats WHERE tg_id = 5001')).rows[0].active, false);
  await send(body());
  assert.equal((await queue.deliverDue()).skipped, 1);
  assert.equal(sent.length, 1, 'no second send to a blocked chat');
});

test('429 pauses the queue and loses nothing', async () => {
  await send(body());
  answer = { ok: false, status: 429, retryAfter: 1 };
  const queue = mkQueue();
  assert.equal((await queue.deliverDue()).paused, true);
  const [row] = await rows();
  assert.equal(row.status, 'pending');
  assert.equal(row.attempts, 0);
  assert.equal((await queue.deliverDue()).paused, true, 'still waiting');
  assert.equal(sent.length, 1);
});

test('another failure is retried later and counted', async () => {
  await send(body());
  answer = { ok: false, status: 500, description: 'oops' };
  assert.equal((await mkQueue().deliverDue()).retry, 1);
  const [row] = await rows();
  assert.equal(row.status, 'pending');
  assert.equal(row.attempts, 1);
});
