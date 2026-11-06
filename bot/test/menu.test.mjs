// The button menu: what /start shows, one tap at a time, answers replace the menu, old and double taps are ignored.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../src/migrate.js';
import { q, closeDb } from '../src/db.js';
import { makeBot } from '../src/app.js';
import { texts } from '../src/texts.js';

const cfg = {
  token: '12345:' + 'a'.repeat(30),
  path: 'p'.repeat(20),
  secret: 's'.repeat(20),
  appUrl: 'https://vertexhash.com',
  supportEmail: 'support@vertexhash.com',
  chatLimitPerMin: 100,
};

function fakeTg() {
  const calls = [];
  let next = 100;
  const ok = { ok: true, status: 200 };
  return {
    calls,
    of: (name) => calls.filter((c) => c.name === name),
    sendMessage: async (chat, text, extra = {}) => {
      const message_id = next++;
      calls.push({ name: 'send', chat, text, extra, message_id });
      return { ...ok, result: { message_id } };
    },
    editMessageText: async (chat, message_id, text, extra = {}) => {
      calls.push({ name: 'edit', chat, message_id, text, extra });
      return ok;
    },
    editMessageReplyMarkup: async (chat, message_id, markup) => {
      calls.push({ name: 'markup', chat, message_id, markup });
      return ok;
    },
    answerCallbackQuery: async (id) => {
      calls.push({ name: 'answer', id });
      return ok;
    },
  };
}

const api = async (name) => {
  if (name === 'balance') return { ok: true, status: 200, json: { btc: 0.5, locked: 0 } };
  return { ok: false, status: 500, json: null };
};

let n = 1;
const msg = (text) => ({ update_id: n++, message: { chat: { id: 1001, type: 'private' }, from: { id: 1001, is_bot: false, language_code: 'en' }, text } });
const tap = (data, mid, over = {}) => ({
  update_id: n++,
  callback_query: { id: `cb${n}`, from: { id: 1001, is_bot: false, ...(over.from || {}) }, data, message: { message_id: mid, chat: { id: 1001, type: 'private', ...(over.chat || {}) } } },
});
const buttons = (rows) => rows.flat();
const dataOf = (rows, action) => buttons(rows).find((b) => b.callback_data && b.callback_data.startsWith(`m:${action}:`))?.callback_data;
const rowsOf = (call) => (call.extra ? call.extra.reply_markup.inline_keyboard : call.markup.inline_keyboard);
const chat = async () => (await q('SELECT lang, news, menu_msg_id, menu_ver FROM chats WHERE tg_id = 1001')).rows[0];

before(async () => {
  await migrate();
});
beforeEach(async () => {
  await q('TRUNCATE chats, processed_updates');
});
after(closeDb);

async function started() {
  const tg = fakeTg();
  const bot = makeBot({ config: cfg, tg, appApi: api });
  await bot.handleUpdate(msg('/start'));
  const first = tg.of('send')[0];
  return { tg, bot, first, mid: first.message_id, rows: rowsOf(first) };
}

test('/start shows the app button and four buttons plus More, and remembers the menu', async () => {
  const { first, rows } = await started();
  assert.equal(rows[0][0].web_app.url, 'https://vertexhash.com');
  const actions = buttons(rows).filter((b) => b.callback_data).map((b) => b.callback_data.split(':')[1]);
  assert.deepEqual(actions, ['bal', 'ear', 'ref', 'more']);
  const c = await chat();
  assert.equal(String(c.menu_msg_id), String(first.message_id));
  assert.ok(buttons(rows).every((b) => !b.callback_data || b.callback_data.endsWith(`:${c.menu_ver}`)));
});

test('a tap answers in the same message, the menu buttons go, one Menu button comes back', async () => {
  const { tg, bot, mid, rows } = await started();
  await bot.handleUpdate(tap(dataOf(rows, 'bal'), mid));
  assert.equal(tg.of('answer').length, 1);
  assert.equal(tg.of('send').length, 1, 'no new message');
  const e = tg.of('edit')[0];
  assert.equal(e.message_id, mid);
  assert.ok(e.text.includes('Balance: 0.50000000 BTC'), e.text);
  const after = rowsOf(e);
  assert.deepEqual(buttons(after).map((b) => b.callback_data.split(':')[1]), ['menu']);
  assert.equal(buttons(after)[0].text, 'Menu');
  const c = await chat();
  assert.ok(buttons(after)[0].callback_data.endsWith(`:${c.menu_ver}`));
});

test('Menu brings the main buttons back in the same message', async () => {
  const { tg, bot, mid, rows } = await started();
  await bot.handleUpdate(tap(dataOf(rows, 'bal'), mid));
  await bot.handleUpdate(tap(dataOf(rowsOf(tg.of('edit')[0]), 'menu'), mid));
  const e = tg.of('edit')[1];
  assert.ok(e.text.includes('VERTEXHASH'));
  assert.deepEqual(buttons(rowsOf(e)).filter((b) => b.callback_data).map((b) => b.callback_data.split(':')[1]), ['bal', 'ear', 'ref', 'more']);
});

test('More opens the second page, Back returns', async () => {
  const { tg, bot, mid, rows } = await started();
  await bot.handleUpdate(tap(dataOf(rows, 'more'), mid));
  const m = tg.of('markup')[0];
  assert.equal(m.message_id, mid);
  const actions = buttons(m.markup.inline_keyboard).map((b) => b.callback_data.split(':')[1]);
  assert.deepEqual(actions, ['link', 'faq', 'help', 'lang', 'stop', 'menu']);
  await bot.handleUpdate(tap(dataOf(m.markup.inline_keyboard, 'menu'), mid));
  assert.ok(tg.of('edit')[0].text.includes('VERTEXHASH'));
});

test('a double tap is answered once', async () => {
  const { tg, bot, mid, rows } = await started();
  const data = dataOf(rows, 'bal');
  await Promise.all([bot.handleUpdate(tap(data, mid)), bot.handleUpdate(tap(data, mid))]);
  assert.equal(tg.of('edit').length, 1);
  assert.equal(tg.of('markup').length, 0, 'the fresh buttons are not removed');
});

test('an old counter on the live menu is ignored', async () => {
  const { tg, bot, mid, rows } = await started();
  const data = dataOf(rows, 'bal');
  await bot.handleUpdate(tap(data, mid));
  await bot.handleUpdate(tap(data, mid));
  assert.equal(tg.of('edit').length, 1);
});

test('a new /start takes the buttons off the old menu, and old buttons do nothing', async () => {
  const { tg, bot, mid, rows } = await started();
  await bot.handleUpdate(msg('/start'));
  const second = tg.of('send')[1];
  const stripped = tg.of('markup').find((c) => c.message_id === mid);
  assert.ok(stripped && stripped.markup.inline_keyboard.length === 0);
  assert.equal(String((await chat()).menu_msg_id), String(second.message_id));
  await bot.handleUpdate(tap(dataOf(rows, 'bal'), mid));
  assert.equal(tg.of('edit').length, 0);
});

test('Stop news turns news off and says so; /start turns it back on', async () => {
  const { tg, bot, mid, rows } = await started();
  await bot.handleUpdate(tap(dataOf(rows, 'more'), mid));
  await bot.handleUpdate(tap(dataOf(tg.of('markup')[0].markup.inline_keyboard, 'stop'), mid));
  assert.equal((await chat()).news, false);
  assert.equal(tg.of('edit')[0].text, texts.en.stopOk);
  await bot.handleUpdate(msg('/start'));
  assert.equal((await chat()).news, true);
});

test('Language switches the chat to Persian and shows the menu in Persian', async () => {
  const { tg, bot, mid, rows } = await started();
  await bot.handleUpdate(tap(dataOf(rows, 'more'), mid));
  await bot.handleUpdate(tap(dataOf(tg.of('markup')[0].markup.inline_keyboard, 'lang'), mid));
  const page = rowsOf(tg.of('edit')[0]);
  assert.deepEqual(buttons(page).map((b) => b.text).slice(0, 2), ['English', '\u0641\u0627\u0631\u0633\u06cc']);
  await bot.handleUpdate(tap(dataOf(page, 'l_fa'), mid));
  assert.equal((await chat()).lang, 'fa');
  const e = tg.of('edit')[1];
  assert.equal(e.text, texts.fa.start);
  assert.equal(buttons(rowsOf(e))[1].text, texts.fa.b_balance);
});

test('an app error shows the try-again text with a Menu button', async () => {
  const { tg, bot, mid, rows } = await started();
  await bot.handleUpdate(tap(dataOf(rows, 'ear'), mid));
  const e = tg.of('edit')[0];
  assert.equal(e.text, texts.en.busy);
  assert.equal(buttons(rowsOf(e))[0].text, 'Menu');
});

test('a failed edit gives the counter back so the buttons keep working', async () => {
  const { tg, bot, mid, rows } = await started();
  const before = (await chat()).menu_ver;
  tg.editMessageText = async () => ({ ok: false, status: 500, description: 'boom' });
  await bot.handleUpdate(tap(dataOf(rows, 'bal'), mid));
  assert.equal((await chat()).menu_ver, before);
});

test('taps from groups, bots, bad data and unknown actions are ignored', async () => {
  const { tg, bot, mid, rows } = await started();
  const v = (await chat()).menu_ver;
  await bot.handleUpdate(tap(dataOf(rows, 'bal'), mid, { chat: { type: 'group' } }));
  await bot.handleUpdate(tap(dataOf(rows, 'bal'), mid, { from: { is_bot: true } }));
  await bot.handleUpdate(tap('garbage', mid));
  await bot.handleUpdate(tap(`m:boom:${v}`, mid));
  assert.equal(tg.of('edit').length, 0);
  assert.equal((await chat()).menu_ver, v);
});

test('every button text exists in en and fa', () => {
  for (const k of ['b_balance', 'b_earnings', 'b_friends', 'b_more', 'b_back', 'b_menu', 'b_link', 'b_faq', 'b_help', 'b_lang', 'b_stop']) {
    assert.ok(texts.en[k] && texts.fa[k], `${k} missing`);
  }
});
