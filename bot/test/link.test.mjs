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

test('/start lnk_CODE asks the app with the Telegram id and the code, then says linked', async () => {
  await say('/start lnk_AB12CD34');
  assert.deepEqual(calls, [{ name: 'link', payload: { tg_id: 7101, code: 'AB12CD34' } }]);
  assert.equal(sent[0].text, 'Account linked.');
});

test('a good link with a masked email names it; no email (older app) says the short text', async () => {
  answer = { ok: true, status: 200, json: { ok: true, email: 'm***@gmail.com' } };
  await say('/start lnk_AB12CD34');
  assert.equal(sent[0].text, 'Linked to m***@gmail.com. The bot now shows this account.');
  for (const bad of ['x', 5, null, 'a b@c.d', 'a@' + 'b'.repeat(300)]) {
    sent.length = 0;
    answer = { ok: true, status: 200, json: { ok: true, email: bad } };
    await say('/start lnk_AB12CD34');
    assert.equal(sent[0].text, 'Account linked.', String(bad));
  }
});

test('a referral code or a bad link shape does not call the app', async () => {
  for (const text of ['/start', '/start abc123', '/start lnk_', '/start lnk_a', '/start lnk_has-dash', '/start lnk_' + 'a'.repeat(33), '/start lnk_bad*chars']) {
    sent.length = 0;
    await say(text);
    assert.equal(sent[0].text, t('en', 'start'), text);
  }
  assert.equal(calls.length, 0);
});

test('wrong or expired code, already linked, too many tries, app down', async () => {
  const cases = [
    [{ ok: false, status: 403, json: { ok: false } }, 'This Telegram already has an account. Open the app here and tap Add email in Settings.'],
    [{ ok: false, status: 404, json: { ok: false } }, 'Code not valid.'],
    [{ ok: false, status: 409, json: { ok: false } }, 'Already linked to another account.'],
    [{ ok: false, status: 429, json: { ok: false } }, 'Too many tries. Wait a few minutes.'],
    [{ ok: false, status: 0, json: null }, 'Try again in a minute.'],
    [{ ok: false, status: 503, json: { ok: false } }, 'Try again in a minute.'],
  ];
  for (const [a, text] of cases) {
    answer = a;
    sent.length = 0;
    await say('/start lnk_abc123');
    assert.equal(sent[0].text, text);
  }
});

test('Persian chat gets the Persian text', async () => {
  await q("INSERT INTO chats (tg_id, lang) VALUES (7101, 'fa')");
  await say('/start lnk_abc123');
  assert.equal(sent[0].text, 'حساب متصل شد.');
  sent.length = 0;
  answer = { ok: true, status: 200, json: { ok: true, email: 'm***@gmail.com' } };
  await say('/start lnk_abc123');
  assert.equal(sent[0].text, 'به m***@gmail.com وصل شد. ربات از این پس این حساب را نشان می‌دهد.');
  sent.length = 0;
  answer = { ok: false, status: 403, json: { ok: false } };
  await say('/start lnk_abc123');
  assert.equal(sent[0].text, t('fa', 'linkHas'));
  assert.ok(sent[0].text.includes('«افزودن ایمیل»'));
});

test('the code is not saved in the bot database', async () => {
  await say('/start lnk_secretcode1');
  const dump = JSON.stringify((await q('SELECT * FROM chats')).rows);
  assert.ok(!dump.toLowerCase().includes('secretcode1'));
});

test('/link and /unlink are gone: they only show the help list and never call the app', async () => {
  for (const text of ['/link abc123', '/unlink']) {
    sent.length = 0;
    await say(text);
    assert.equal(sent[0].text, sent[0].text.split('\n').filter((l) => l.startsWith('/')).join('\n'));
    assert.ok(!sent[0].text.includes('/link') && !sent[0].text.includes('/unlink'), text);
  }
  assert.equal(calls.length, 0);
});

test('the command list has no link or unlink; the link answers exist in en and fa', () => {
  for (const lang of ['en', 'fa']) {
    const names = commandList(lang).map((c) => c.command);
    assert.ok(!names.includes('link') && !names.includes('unlink'));
  }
  for (const k of ['linkOk', 'linkDone', 'linkHas', 'linkBad', 'linkTaken', 'linkMany']) assert.ok(texts.en[k] && texts.fa[k], `${k} missing`);
});
