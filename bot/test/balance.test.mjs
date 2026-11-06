import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { migrate } from '../src/migrate.js';
import { q, closeDb } from '../src/db.js';
import { makeBot } from '../src/app.js';
import { makeAppApi } from '../src/appapi.js';
import { verifySig } from '../src/notify.js';
import { commandList, texts, t } from '../src/texts.js';

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
const tg = {
  sendMessage: async (chat, text, extra = {}) => {
    sent.push({ chat, text, extra });
    return { ok: true, status: 200 };
  },
};
const calls = [];
let answer = { ok: true, status: 200, json: { ok: true, btc: 0.00123456, locked: 0.0005, usd: 85.2 } };
const appApi = async (name, payload) => {
  calls.push({ name, payload });
  return answer;
};
const bot = makeBot({ config: cfg, tg, appApi });
const say = (text, from = {}) => bot.handleUpdate({ message: { chat: { id: 7001, type: 'private' }, from: { id: 7001, language_code: 'en', ...from }, text } });

before(async () => {
  await migrate();
});
beforeEach(async () => {
  sent.length = 0;
  calls.length = 0;
  answer = { ok: true, status: 200, json: { ok: true, btc: 0.00123456, locked: 0.0005, usd: 85.2 } };
  await q('TRUNCATE chats, processed_updates');
});
after(async () => {
  await closeDb();
});

test('/balance asks the app with the Telegram id and shows BTC, USD and the hold', async () => {
  await say('/balance');
  assert.deepEqual(calls, [{ name: 'balance', payload: { tg_id: 7001 } }]);
  assert.equal(sent[0].text, 'Balance: 0.00123456 BTC\n≈ $85.20\nOn hold: 0.00050000 BTC');
});

test('no USD line without a real price, no hold line without a hold', async () => {
  answer = { ok: true, status: 200, json: { ok: true, btc: 0.5, locked: 0, usd: null } };
  await say('/balance');
  assert.equal(sent[0].text, 'Balance: 0.50000000 BTC');
});

test('Persian chat gets the Persian text', async () => {
  await q("INSERT INTO chats (tg_id, lang) VALUES (7001, 'fa')");
  await say('/balance');
  assert.equal(sent[0].text, 'موجودی: 0.00123456 BTC\n≈ $85.20\nمسدود: 0.00050000 BTC');
});

test('no account: message and Open app button', async () => {
  answer = { ok: false, status: 404, json: { ok: false, error: 'No account.' } };
  await say('/balance');
  assert.equal(sent[0].text, 'No account found. Open the app first.');
  assert.equal(sent[0].extra.reply_markup.inline_keyboard[0][0].web_app.url, cfg.appUrl);
});

test('app down, switched off or odd answer: Try again in a minute', async () => {
  for (const a of [
    { ok: false, status: 0, json: null },
    { ok: false, status: 503, json: { ok: false } },
    { ok: true, status: 200, json: { ok: true, btc: 'x', locked: 0 } },
  ]) {
    answer = a;
    sent.length = 0;
    await say('/balance');
    assert.equal(sent[0].text, 'Try again in a minute.');
  }
});

test('the menu lists /balance and the texts exist in en and fa', () => {
  assert.ok(commandList('en').some((c) => c.command === 'balance' && c.description === 'Show balance'));
  for (const k of ['bal', 'balUsd', 'balHold', 'noAcc', 'busy', 'd_balance']) assert.ok(texts.en[k] && texts.fa[k], `${k} missing`);
  assert.equal(t('fa', 'd_balance'), 'نمایش موجودی');
});

test('the app caller signs the body the way the app checks it', async () => {
  let seen = null;
  const srv = createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      seen = { url: req.url, body: verifySig(raw, req.headers['x-app-sig'], SECRET) };
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, btc: 1, locked: 0, usd: null }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const call = makeAppApi({ config: { ...cfg, appUrl: `http://127.0.0.1:${srv.address().port}` } });
    const r = await call('balance', { tg_id: 42 });
    assert.equal(r.ok, true);
    assert.equal(seen.url, '/api/bot/balance');
    assert.equal(seen.body.tg_id, 42);
    assert.equal(r.json.btc, 1);
  } finally {
    await new Promise((r) => srv.close(r));
  }
});

test('the app caller is off without the secret and never throws', async () => {
  assert.deepEqual(await makeAppApi({ config: { ...cfg, notifySecret: '' } })('balance', { tg_id: 1 }), { ok: false, status: 0, json: null });
  const down = makeAppApi({ config: { ...cfg, appUrl: 'http://127.0.0.1:1' }, timeoutMs: 500 });
  assert.deepEqual(await down('balance', { tg_id: 1 }), { ok: false, status: 0, json: null });
});
