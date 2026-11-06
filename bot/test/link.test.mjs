import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../src/migrate.js';
import { q, closeDb } from '../src/db.js';
import { makeBot } from '../src/app.js';
import { commandList, texts, t } from '../src/texts.js';

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
const sent = [];
const tg = {
  sendMessage: async (chat, text, extra = {}) => {
    sent.push({ chat, text, extra });
    return { ok: true, status: 200 };
  },
};
const calls = [];
let answer = { ok: true, status: 200, json: { ok: true } };
const appApi = async (name, payload) => {
  calls.push({ name, payload });
  return answer;
};
const bot = makeBot({ config: cfg, tg, appApi });
const say = (text) => bot.handleUpdate({ message: { chat: { id: 7101, type: 'private' }, from: { id: 7101, language_code: 'en' }, text } });

before(async () => {
  await migrate();
});
beforeEach(async () => {
  sent.length = 0;
  calls.length = 0;
  answer = { ok: true, status: 200, json: { ok: true } };
  await q('TRUNCATE chats, processed_updates');
});
after(async () => {
  await closeDb();
});

test('/link CODE asks the app with the Telegram id and the code, then says linked', async () => {
  await say('/link AB12-CD34');
  assert.deepEqual(calls, [{ name: 'link', payload: { tg_id: 7101, code: 'ab12-cd34' } }]);
  assert.equal(sent[0].text, 'Account linked.');
});

test('no code or a bad code shape: usage text, the app is not called', async () => {
  for (const text of ['/link', '/link a', '/link has space x', '/link ' + 'a'.repeat(33), '/link bad*chars']) {
    sent.length = 0;
    await say(text);
    assert.equal(sent[0].text, 'Send /link CODE. Get the code in Settings.');
  }
  assert.equal(calls.length, 0);
});

test('wrong or expired code, already linked, too many tries, app down', async () => {
  const cases = [
    [{ ok: false, status: 404, json: { ok: false } }, 'Code not valid.'],
    [{ ok: false, status: 409, json: { ok: false } }, 'Already linked to another account.'],
    [{ ok: false, status: 429, json: { ok: false } }, 'Too many tries. Wait a few minutes.'],
    [{ ok: false, status: 0, json: null }, 'Try again in a minute.'],
    [{ ok: false, status: 503, json: { ok: false } }, 'Try again in a minute.'],
  ];
  for (const [a, text] of cases) {
    answer = a;
    sent.length = 0;
    await say('/link abc123');
    assert.equal(sent[0].text, text);
  }
});

test('Persian chat gets the Persian text', async () => {
  await q("INSERT INTO chats (tg_id, lang) VALUES (7101, 'fa')");
  await say('/link abc123');
  assert.equal(sent[0].text, 'حساب متصل شد.');
});

test('the code is not saved in the bot database', async () => {
  await say('/link secretcode1');
  const dump = JSON.stringify((await q('SELECT * FROM chats')).rows);
  assert.ok(!dump.toLowerCase().includes('secretcode1'));
});

test('/unlink asks the app with the Telegram id and says unlinked', async () => {
  await say('/unlink');
  assert.deepEqual(calls, [{ name: 'unlink', payload: { tg_id: 7101 } }]);
  assert.equal(sent[0].text, 'Account unlinked.');
});

test('/unlink with nothing linked, or app down', async () => {
  const cases = [
    [{ ok: false, status: 404, json: { ok: false } }, 'No account is linked.'],
    [{ ok: false, status: 0, json: null }, 'Try again in a minute.'],
    [{ ok: false, status: 503, json: { ok: false } }, 'Try again in a minute.'],
  ];
  for (const [a, text] of cases) {
    answer = a;
    sent.length = 0;
    await say('/unlink');
    assert.equal(sent[0].text, text);
  }
});

test('the menu lists /link and the texts exist in en and fa', () => {
  assert.ok(commandList('en').some((c) => c.command === 'link' && c.description === 'Link your account'));
  for (const k of ['linkUsage', 'linkOk', 'linkBad', 'linkTaken', 'linkMany', 'd_link']) assert.ok(texts.en[k] && texts.fa[k], `${k} missing`);
  assert.equal(t('fa', 'd_link'), 'اتصال حساب');
  assert.ok(commandList('en').some((c) => c.command === 'unlink' && c.description === 'Unlink your account'));
  assert.equal(t('en', 'unlinkOk'), 'Account unlinked.');
});
