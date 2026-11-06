import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../src/migrate.js';
import { q, closeDb } from '../src/db.js';
import { makeBot } from '../src/app.js';

const cfg = {
  token: '12345:' + 'a'.repeat(30),
  path: 'p'.repeat(20),
  secret: 's'.repeat(20),
  appUrl: 'https://vertexhash.com',
  supportEmail: 'support@vertexhash.com',
  chatLimitPerMin: 3,
};

function fakeTg(result = { ok: true, status: 200 }) {
  const sent = [];
  return {
    sent,
    sendMessage: async (chat, text, extra = {}) => {
      sent.push({ chat, text, extra });
      return result;
    },
  };
}

let n = 1;
const msg = (text, over = {}) => ({
  update_id: n++,
  message: { chat: { id: 1001, type: 'private' }, from: { id: 1001, is_bot: false, language_code: 'en', ...(over.from || {}) }, text, ...(over.message || {}) },
});

before(async () => {
  await migrate();
});
beforeEach(async () => {
  await q('TRUNCATE chats, processed_updates');
});
after(closeDb);

test('/start opens the app with a Web App button and saves the chat', async () => {
  const tg = fakeTg();
  const bot = makeBot({ config: cfg, tg });
  await bot.handleUpdate(msg('/start'));
  assert.equal(tg.sent.length, 1);
  assert.equal(tg.sent[0].chat, 1001);
  assert.equal(tg.sent[0].extra.reply_markup.inline_keyboard[0][0].web_app.url, 'https://vertexhash.com');
  const r = await q('SELECT lang, active FROM chats WHERE tg_id = 1001');
  assert.equal(r.rows[0].lang, 'en');
  assert.equal(r.rows[0].active, true);
});

test('/start@SomeBot and a start payload still work', async () => {
  const tg = fakeTg();
  const bot = makeBot({ config: cfg, tg });
  await bot.handleUpdate(msg('/start@SomeBot VTX-1234'));
  assert.equal(tg.sent.length, 1);
  assert.ok(tg.sent[0].extra.reply_markup.inline_keyboard[0][0].web_app);
});

test('/start CODE opens the app on sign-up with the code, case kept; a bad code is ignored', async () => {
  const tg = fakeTg();
  const bot = makeBot({ config: cfg, tg });
  await bot.handleUpdate(msg('/start VTX-AbC1'));
  assert.equal(tg.sent[0].extra.reply_markup.inline_keyboard[0][0].web_app.url, 'https://vertexhash.com/login?ref=VTX-AbC1');
  await bot.handleUpdate(msg('/start x<y>'));
  assert.equal(tg.sent[1].extra.reply_markup.inline_keyboard[0][0].web_app.url, 'https://vertexhash.com');
});

test('unknown text and /help show the command list', async () => {
  const tg = fakeTg();
  const bot = makeBot({ config: cfg, tg });
  await bot.handleUpdate(msg('hello there'));
  await bot.handleUpdate(msg('/help'));
  assert.equal(tg.sent.length, 2);
  for (const s of tg.sent) assert.ok(s.text.includes('/start') && s.text.includes('/faq') && s.text.includes('/support'));
});

test('/faq links to the FAQ page and /support shows the email', async () => {
  const tg = fakeTg();
  const bot = makeBot({ config: cfg, tg });
  await bot.handleUpdate(msg('/faq'));
  await bot.handleUpdate(msg('/support'));
  assert.equal(tg.sent[0].extra.reply_markup.inline_keyboard[0][0].url, 'https://vertexhash.com/faq');
  assert.ok(tg.sent[1].text.includes('support@vertexhash.com'));
});

test('groups, bots and non-text messages are ignored', async () => {
  const tg = fakeTg();
  const bot = makeBot({ config: cfg, tg });
  await bot.handleUpdate(msg('/start', { message: { chat: { id: -5, type: 'group' } } }));
  await bot.handleUpdate(msg('/start', { from: { is_bot: true } }));
  await bot.handleUpdate({ update_id: n++, message: { chat: { id: 1001, type: 'private' }, from: { id: 1001, is_bot: false }, sticker: {} } });
  assert.equal(tg.sent.length, 0);
  assert.equal((await q('SELECT count(*)::int AS c FROM chats')).rows[0].c, 0);
});

test('a chat is limited per minute', async () => {
  const tg = fakeTg();
  const bot = makeBot({ config: cfg, tg });
  for (let i = 0; i < 5; i++) await bot.handleUpdate(msg('/help'));
  assert.equal(tg.sent.length, 3);
});

test('blocking the bot marks the chat inactive, writing again turns it on', async () => {
  const tg = fakeTg();
  const bot = makeBot({ config: cfg, tg });
  await bot.handleUpdate(msg('/help'));
  await bot.handleUpdate({ update_id: n++, my_chat_member: { chat: { id: 1001, type: 'private' }, new_chat_member: { status: 'kicked' } } });
  assert.equal((await q('SELECT active FROM chats WHERE tg_id = 1001')).rows[0].active, false);
  await bot.handleUpdate(msg('/help'));
  assert.equal((await q('SELECT active FROM chats WHERE tg_id = 1001')).rows[0].active, true);
});

test('a 403 from Telegram marks the chat inactive', async () => {
  const tg = fakeTg({ ok: false, status: 403 });
  const bot = makeBot({ config: cfg, tg });
  await bot.handleUpdate(msg('/help'));
  assert.equal((await q('SELECT active FROM chats WHERE tg_id = 1001')).rows[0].active, false);
});

test('a Persian Telegram language is remembered but texts fall back to English until fa is approved', async () => {
  const tg = fakeTg();
  const bot = makeBot({ config: cfg, tg });
  await bot.handleUpdate(msg('/start', { from: { language_code: 'fa' } }));
  assert.equal((await q('SELECT lang FROM chats WHERE tg_id = 1001')).rows[0].lang, 'fa');
  assert.ok(tg.sent[0].text.includes('VERTEXHASH'));
});
