// Admin Telegram news (action 'tg-broadcast'): input checks, the signed call to the bot, and what the admin gets back.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const { act } = await import('@/lib/server/admin');
const { signBody } = await import('@/lib/server/botnotify');

const SECRET = 'tgbroadcast-test-secret-0123456789';
const was = { url: process.env.BOT_URL, secret: process.env.APP_BOT_SECRET, fetch: globalThis.fetch };
const calls = [];
let reply = { status: 200, json: { ok: true, queued: 0 } };

before(async () => {
  await migrate();
  process.env.BOT_URL = 'http://bot.test';
  process.env.APP_BOT_SECRET = SECRET;
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith('http://bot.test')) return was.fetch(url, init);
    calls.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(reply.json), { status: reply.status, headers: { 'content-type': 'application/json' } });
  };
});

after(async () => {
  globalThis.fetch = was.fetch;
  for (const [k, v] of [['BOT_URL', was.url], ['APP_BOT_SECRET', was.secret]]) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await pool().end();
});

const send = (extra) => act({ action: 'tg-broadcast', ...extra });

test('bad input is refused and nothing reaches the bot', async () => {
  calls.length = 0;
  assert.equal((await send({ mode: 'nope', text: 'Hi' })).status, 400);
  assert.equal((await send({ mode: 'all', text: '   ' })).status, 422);
  assert.equal((await send({ mode: 'all', text: 'x'.repeat(1001) })).status, 422);
  assert.equal((await send({ mode: 'all', text: 'Hi', textFa: 'x'.repeat(1001) })).status, 422);
  assert.equal((await send({ mode: 'test', text: 'Hi' })).status, 422); // no Telegram ID
  assert.equal((await send({ mode: 'test', text: 'Hi', testId: 'abc' })).status, 422);
  assert.equal((await send({ mode: 'test', text: 'Hi', testId: '-5' })).status, 422);
  assert.equal(calls.length, 0);
});

test('a test goes to one chat, signed, with the Telegram ID cleaned up', async () => {
  calls.length = 0;
  reply = { status: 200, json: { ok: true, queued: 1 } };
  const r = await send({ mode: 'test', text: ' Hello ', textFa: ' سلام ', testId: ' tg:12345 ' });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.queued, 1);
  assert.equal(calls.length, 1);
  const c = calls[0];
  assert.equal(c.url, 'http://bot.test/broadcast');
  assert.equal(c.body.en, 'Hello');
  assert.equal(c.body.fa, 'سلام');
  assert.equal(c.body.test_tg_id, 12345);
  assert.match(c.body.id, /^[a-z0-9]{8,64}$/);
  assert.equal(c.headers['x-app-sig'], signBody(c.body, SECRET));
});

test('send to all has no test chat, no Persian when empty, and a new id each time', async () => {
  calls.length = 0;
  reply = { status: 200, json: { ok: true, queued: 42 } };
  const a = await send({ mode: 'all', text: 'News' });
  const b = await send({ mode: 'all', text: 'News' });
  assert.equal(a.queued, 42);
  assert.ok(b.ok);
  assert.equal(calls.length, 2);
  for (const c of calls) {
    assert.equal(Object.hasOwn(c.body, 'test_tg_id'), false);
    assert.equal(Object.hasOwn(c.body, 'fa'), false);
    assert.equal(c.body.en, 'News');
  }
  assert.notEqual(calls[0].body.id, calls[1].body.id);
});

test('bot errors become plain messages', async () => {
  reply = { status: 503, json: { ok: false } };
  const full = await send({ mode: 'all', text: 'News' });
  assert.equal(full.status, 502);
  assert.match(full.error, /queue is full/);
  reply = { status: 400, json: { ok: false } };
  const refused = await send({ mode: 'all', text: 'News' });
  assert.equal(refused.status, 502);
  assert.match(refused.error, /refused/);
});

test('the bot being off or silent is reported, and the action is logged', async () => {
  const url = process.env.BOT_URL;
  delete process.env.BOT_URL;
  assert.equal((await send({ mode: 'all', text: 'News' })).status, 503);
  process.env.BOT_URL = url;

  const real = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('down');
  };
  const silent = await send({ mode: 'all', text: 'News' });
  globalThis.fetch = real;
  assert.equal(silent.status, 502);
  assert.match(silent.error, /did not answer/);

  reply = { status: 200, json: { ok: true, queued: 3 } };
  const t0 = Date.now();
  assert.ok((await send({ mode: 'all', text: 'Logged' })).ok);
  const { q } = await import('@/lib/server/db');
  const log = (await q("SELECT data FROM meta WHERE key = 'adminlog'")).rows[0]?.data || [];
  assert.ok(log.some((e) => e.action === 'tg-broadcast' && e.at >= t0));
});
