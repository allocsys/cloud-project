import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../src/migrate.js';
import { q, closeDb } from '../src/db.js';
import { makeBot } from '../src/app.js';
import { texts, t } from '../src/texts.js';

const cfg = {
  token: '12345:' + 'a'.repeat(30),
  path: 'p'.repeat(20),
  secret: 's'.repeat(20),
  appUrl: 'https://vertexhash.com',
  supportEmail: 'support@vertexhash.com',
  chatLimitPerMin: 50,
  notifySecret: 'n'.repeat(32),
  notifyPerSec: 25,
};
const ID = 7201;
const MID = 55;
const sent = [];
const edits = [];
const tg = {
  sendMessage: async (chat, text, extra = {}) => {
    sent.push({ chat, text, extra });
    return { ok: true, status: 200, result: { message_id: 900 + sent.length } };
  },
  answerCallbackQuery: async () => ({ ok: true }),
  editMessageText: async (chat, mid, text, extra = {}) => {
    edits.push({ chat, mid, text, extra });
    return { ok: true, status: 200 };
  },
  editMessageReplyMarkup: async () => ({ ok: true }),
};
const calls = [];
let answer;
let delayMs = 0;
const appApi = async (name, payload) => {
  calls.push({ name, payload });
  if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  return typeof answer === 'function' ? answer(payload) : answer;
};
const bot = makeBot({ config: cfg, tg, appApi });
const ASK = { ok: false, status: 428, json: { ok: false, confirm: true, email: 'm***@gmail.com' } };
const say = (text) => bot.handleUpdate({ message: { chat: { id: ID, type: 'private' }, from: { id: ID, language_code: 'en' }, text } });
const tap = (data) => bot.handleUpdate({ callback_query: { id: 'cb1', from: { id: ID }, message: { chat: { id: ID, type: 'private' }, message_id: MID }, data } });

before(async () => {
  await migrate();
});
beforeEach(async () => {
  sent.length = 0;
  edits.length = 0;
  calls.length = 0;
  delayMs = 0;
  answer = ASK;
  await q('TRUNCATE chats, processed_updates');
});
after(async () => {
  await closeDb();
});

test('an existing Telegram account: the app answers 428, the bot asks with Merge and Cancel and does not show the menu', async () => {
  await say('/start lnk_AB12CD34');
  assert.deepEqual(calls, [{ name: 'link', payload: { tg_id: ID, code: 'AB12CD34' } }]);
  assert.equal(sent[0].text, t('en', 'mergeAsk', { email: 'm***@gmail.com' }));
  const rows = sent[0].extra.reply_markup.inline_keyboard;
  assert.deepEqual(rows.map((r) => r.length), [1, 1]);
  assert.equal(rows[0][0].text, t('en', 'b_merge'));
  assert.equal(rows[0][0].callback_data, 'k:y:AB12CD34');
  assert.equal(rows[1][0].text, t('en', 'b_cancel'));
  assert.equal(rows[1][0].callback_data, 'k:n');
  // The second message is the permanent Menu button, nothing else.
  assert.equal(sent[1].text, t('en', 'kbOn'));
  assert.equal(sent.length, 2);
});

test('Merge asks the app again with confirm and shows the merged text', async () => {
  await say('/start lnk_AB12CD34');
  calls.length = 0;
  answer = { ok: true, status: 200, json: { ok: true, email: 'm***@gmail.com', merged: true } };
  await tap('k:y:AB12CD34');
  assert.deepEqual(calls, [{ name: 'link', payload: { tg_id: ID, code: 'AB12CD34', confirm: true } }]);
  assert.equal(edits.length, 1);
  assert.equal(edits[0].mid, MID);
  assert.equal(edits[0].text, 'Accounts merged into m***@gmail.com. The bot now shows this account.');
  // The buttons are gone: only Open app stays.
  assert.deepEqual(edits[0].extra.reply_markup.inline_keyboard.map((r) => r.length), [1]);
  assert.ok(edits[0].extra.reply_markup.inline_keyboard[0][0].web_app);
});

test('Merge with no email in the answer says the short text', async () => {
  answer = { ok: true, status: 200, json: { ok: true, merged: true } };
  await tap('k:y:AB12CD34');
  assert.equal(edits[0].text, t('en', 'mergeOk'));
});

test('Cancel changes nothing and does not call the app', async () => {
  await tap('k:n');
  assert.equal(calls.length, 0);
  assert.equal(edits[0].text, 'Cancelled. Nothing changed.');
});

test('the app cannot be reached on Merge: the buttons stay, the person is told to try again', async () => {
  answer = { ok: false, status: 0, json: null };
  await tap('k:y:AB12CD34');
  assert.equal(edits.length, 0);
  assert.equal(sent[0].text, t('en', 'busy'));
  // A second tap works once the app answers.
  answer = { ok: true, status: 200, json: { ok: true, email: 'm***@gmail.com', merged: true } };
  await tap('k:y:AB12CD34');
  assert.equal(edits.length, 1);
});

test('unfinished payment, blocked, wrong code and too many tries on Merge replace the question with that text', async () => {
  const cases = [
    [423, 'Finish your payment or withdrawal first, then try again.'],
    [403, 'This Telegram cannot be linked.'],
    [404, 'Code not valid.'],
    [409, 'Already linked to another account.'],
    [429, 'Too many tries. Wait a few minutes.'],
  ];
  for (const [status, text] of cases) {
    edits.length = 0;
    answer = { ok: false, status, json: { ok: false } };
    await tap('k:y:AB12CD34');
    assert.equal(edits[0].text, text, String(status));
  }
});

test('a double tap on Merge calls the app once', async () => {
  delayMs = 40;
  answer = { ok: true, status: 200, json: { ok: true, email: 'm***@gmail.com', merged: true } };
  await Promise.all([tap('k:y:AB12CD34'), tap('k:y:AB12CD34')]);
  assert.equal(calls.length, 1);
  assert.equal(edits.length, 1);
});

test('a 428 without a good email, or a 428 after confirm, is not turned into a question', async () => {
  answer = { ok: false, status: 428, json: { ok: false, confirm: true } };
  await say('/start lnk_AB12CD34');
  assert.equal(sent[0].text, t('en', 'busy'));
  edits.length = 0;
  answer = ASK;
  await tap('k:y:AB12CD34');
  assert.equal(sent[sent.length - 1].text, t('en', 'busy'));
  assert.equal(edits.length, 0);
});

test('bad button data is ignored', async () => {
  for (const data of ['k:y:', 'k:y:ab', 'k:y:' + 'a'.repeat(33), 'k:y:bad*code', 'k:x', 'k:n:1']) {
    await tap(data);
  }
  assert.equal(calls.length, 0);
  assert.equal(edits.length, 0);
});

test('the link code is not saved in the bot database', async () => {
  await say('/start lnk_secretcode1');
  const dump = JSON.stringify((await q('SELECT * FROM chats')).rows);
  assert.ok(!dump.toLowerCase().includes('secretcode1'));
});

test('the longest code still fits the 64 byte button limit', async () => {
  await say('/start lnk_' + 'a'.repeat(32));
  const data = sent[0].extra.reply_markup.inline_keyboard[0][0].callback_data;
  assert.ok(Buffer.byteLength(data) <= 64);
});

test('Persian chat gets the Persian question', async () => {
  await q("INSERT INTO chats (tg_id, lang) VALUES ($1, 'fa')", [ID]);
  await say('/start lnk_abc123');
  assert.equal(sent[0].text, t('fa', 'mergeAsk', { email: 'm***@gmail.com' }));
  assert.equal(sent[0].extra.reply_markup.inline_keyboard[0][0].text, t('fa', 'b_merge'));
});

test('all six languages have the merge texts and the question names the email', () => {
  for (const lang of ['en', 'fa', 'ar', 'fi', 'ru', 'sv']) {
    for (const k of ['mergeAsk', 'mergeDone', 'mergeOk', 'mergeNo', 'linkNo', 'linkPay', 'b_merge', 'b_cancel']) assert.ok(texts[lang][k], `${lang}.${k} missing`);
    assert.ok(texts[lang].mergeAsk.includes('{email}') && texts[lang].mergeDone.includes('{email}'), lang);
    assert.equal(texts[lang].linkHas, undefined, lang);
  }
});
