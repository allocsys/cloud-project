// Accept and Deny under the withdrawal code message: the queue adds the buttons, a tap asks the app and the answer replaces the code text.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../src/migrate.js';
import { q, closeDb } from '../src/db.js';
import { makeBot } from '../src/app.js';
import { makeQueue, enqueue } from '../src/queue.js';
import { texts } from '../src/texts.js';

const cfg = {
  token: '12345:' + 'a'.repeat(30),
  path: 'p'.repeat(20),
  secret: 's'.repeat(20),
  appUrl: 'https://vertexhash.com',
  supportEmail: 'support@vertexhash.com',
  chatLimitPerMin: 100,
  notifySecret: 'n'.repeat(32),
  notifyPerSec: 25,
};
const REF = 1762500000123;

function fakeTg() {
  const calls = [];
  const ok = { ok: true, status: 200 };
  return {
    calls,
    of: (name) => calls.filter((c) => c.name === name),
    sendMessage: async (chat, text, extra = {}) => {
      calls.push({ name: 'send', chat, text, extra });
      return { ...ok, result: { message_id: 500 } };
    },
    editMessageText: async (chat, message_id, text, extra = {}) => {
      calls.push({ name: 'edit', chat, message_id, text, extra });
      return ok;
    },
    editMessageReplyMarkup: async () => ok,
    answerCallbackQuery: async (id) => {
      calls.push({ name: 'answer', id });
      return ok;
    },
  };
}

let n = 1;
const tap = (data, over = {}) => ({
  update_id: n++,
  callback_query: { id: `cb${n}`, from: { id: 1001, is_bot: false }, data, message: { message_id: 77, chat: { id: 1001, type: 'private', ...(over.chat || {}) } } },
});
const flat = (extra) => extra.reply_markup.inline_keyboard.flat();

before(async () => {
  await migrate();
});
beforeEach(async () => {
  await q('TRUNCATE chats, processed_updates, notify_outbox');
});
after(closeDb);

async function deliver(kind, vars, lang = null) {
  const tg = fakeTg();
  await enqueue({ tg_id: 1001, kind, key: `k${Date.now()}${n++}abcd`, lang, vars });
  await makeQueue({ tg, config: cfg, sleep: async () => {} }).deliverDue();
  return tg.of('send')[0];
}

test('the code message gets Accept (green), Deny (red) and Open app, each on its own row', async () => {
  const m = await deliver('wdCode', { code: '123456', ref: REF });
  assert.ok(m.text.includes('123456'));
  const rows = m.extra.reply_markup.inline_keyboard;
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], [{ text: texts.en.b_wdOk, callback_data: `w:a:${REF}`, style: 'success' }]);
  assert.deepEqual(rows[1], [{ text: texts.en.b_wdNo, callback_data: `w:d:${REF}`, style: 'danger' }]);
  assert.equal(rows[2][0].web_app.url, 'https://vertexhash.com');
  assert.ok(rows.flat().every((b) => !b.callback_data || Buffer.byteLength(b.callback_data) <= 64));
});

test('no ref (an older app) or another kind: only the Open app button', async () => {
  const old = await deliver('wdCode', { code: '123456' });
  assert.deepEqual(flat(old.extra).map((b) => b.text), [texts.en.open]);
  const dep = await deliver('depPaid', { usd: '50.00' });
  assert.deepEqual(flat(dep.extra).map((b) => b.text), [texts.en.open]);
});

async function tapWith(data, answer, lang = 'en') {
  await q('INSERT INTO chats (tg_id, lang) VALUES (1001, $1) ON CONFLICT (tg_id) DO UPDATE SET lang = $1', [lang]);
  const tg = fakeTg();
  const seen = [];
  const bot = makeBot({
    config: cfg,
    tg,
    appApi: async (name, body) => {
      seen.push({ name, body });
      return answer;
    },
  });
  await bot.handleUpdate(tap(data));
  return { tg, seen };
}

test('Accept: asks the app, then the code text is replaced by the answer and only Open app stays', async () => {
  const { tg, seen } = await tapWith(`w:a:${REF}`, { ok: true, status: 200, json: { ok: true } });
  assert.equal(tg.of('answer').length, 1);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].name, 'wdcode');
  assert.deepEqual(seen[0].body, { tg_id: 1001, act: 'accept', ref: REF });
  const e = tg.of('edit')[0];
  assert.equal(e.message_id, 77);
  assert.equal(e.text, texts.en.wdOk);
  assert.deepEqual(flat(e.extra).map((b) => b.text), [texts.en.open]);
});

test('Deny: the answer says the withdrawal was cancelled', async () => {
  const { tg, seen } = await tapWith(`w:d:${REF}`, { ok: true, status: 200, json: { ok: true } });
  assert.deepEqual(seen[0].body, { tg_id: 1001, act: 'deny', ref: REF });
  assert.equal(tg.of('edit')[0].text, texts.en.wdNo);
});

test('a Persian chat gets the Persian answer', async () => {
  const { tg } = await tapWith(`w:d:${REF}`, { ok: true, status: 200, json: { ok: true } }, 'fa');
  assert.equal(tg.of('edit')[0].text, texts.fa.wdNo);
  assert.notEqual(texts.fa.wdNo, texts.en.wdNo);
});

test('an old, used or expired code (404): "no longer valid", buttons gone', async () => {
  const { tg } = await tapWith(`w:a:${REF}`, { ok: false, status: 404, json: { ok: false } });
  const e = tg.of('edit')[0];
  assert.equal(e.text, texts.en.wdGone);
  assert.deepEqual(flat(e.extra).map((b) => b.text), [texts.en.open]);
});

test('the app is down or busy: a short message, the buttons stay so the tap can be tried again', async () => {
  for (const answer of [{ ok: false, status: 0, json: null }, { ok: false, status: 500, json: null }, { ok: false, status: 503, json: { ok: false } }]) {
    const { tg } = await tapWith(`w:a:${REF}`, answer);
    assert.equal(tg.of('edit').length, 0, 'the message is not touched');
    assert.equal(tg.of('send')[0].text, texts.en.busy);
  }
});

test('taps that do not match are ignored: wrong shape, short ref, group chat', async () => {
  for (const data of ['w:x:' + REF, 'w:a:123', 'w:a:', `w:a:${REF}:1`, 'W:a:' + REF]) {
    const { tg, seen } = await tapWith(data, { ok: true, status: 200, json: { ok: true } });
    assert.equal(seen.length, 0, data);
    assert.equal(tg.of('edit').length, 0, data);
  }
  const tg = fakeTg();
  const seen = [];
  const bot = makeBot({ config: cfg, tg, appApi: async (name) => (seen.push(name), { ok: true, status: 200, json: { ok: true } }) });
  await bot.handleUpdate(tap(`w:a:${REF}`, { chat: { type: 'group' } }));
  assert.equal(seen.length, 0);
});
