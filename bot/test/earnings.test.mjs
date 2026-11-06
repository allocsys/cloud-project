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
  chatLimitPerMin: 20,
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
let answer = null;
const appApi = async (name, payload) => {
  calls.push({ name, payload });
  return answer;
};
const bot = makeBot({ config: cfg, tg, appApi });
const say = (text) => bot.handleUpdate({ message: { chat: { id: 7002, type: 'private' }, from: { id: 7002, language_code: 'en' }, text } });
const good = (json) => ({ ok: true, status: 200, json: { ok: true, ...json } });

before(async () => {
  await migrate();
});
beforeEach(async () => {
  sent.length = 0;
  calls.length = 0;
  await q('TRUNCATE chats, processed_updates');
});
after(async () => {
  await closeDb();
});

test('/earnings asks the app with the Telegram id and shows today, total and per day', async () => {
  answer = good({ miners: true, today: 0.00001234, total: 0.00123456, avgUsd: 4.5 });
  await say('/earnings');
  assert.deepEqual(calls, [{ name: 'earnings', payload: { tg_id: 7002 } }]);
  assert.equal(sent[0].text, 'Today: 0.00001234 BTC\nTotal: 0.00123456 BTC\nPer day: ≈ $4.50');
});

test('/earnings with no miner: message and Open app button', async () => {
  answer = good({ miners: false, today: 0, total: 0, avgUsd: 0 });
  await say('/earnings');
  assert.equal(sent[0].text, 'No miners yet. Open the app to start.');
  assert.equal(sent[0].extra.reply_markup.inline_keyboard[0][0].web_app.url, cfg.appUrl);
});

test('/earnings in Persian', async () => {
  await q("INSERT INTO chats (tg_id, lang) VALUES (7002, 'fa')");
  answer = good({ miners: true, today: 0, total: 0.5, avgUsd: 1 });
  await say('/earnings');
  assert.equal(sent[0].text, 'امروز: 0.00000000 BTC\nمجموع: 0.50000000 BTC\nروزانه: ≈ $1.00');
});

test('/referrals shows code, friends, earned and VIP; code and links are buttons', async () => {
  answer = good({ code: 'VTX-AB2C', friends: 3, active: 2, earned: 0.0002, vip: 1 });
  await say('/referrals');
  assert.deepEqual(calls, [{ name: 'referrals', payload: { tg_id: 7002 } }]);
  assert.equal(sent[0].text, 'Your code: VTX-AB2C\nFriends: 3 (2 active)\nEarned: 0.00020000 BTC\nVIP: 1');
  const kb = sent[0].extra.reply_markup.inline_keyboard;
  assert.deepEqual(kb[0], [
    { text: 'Copy code', copy_text: { text: 'VTX-AB2C' } },
    { text: 'Copy link', copy_text: { text: 'https://vertexhash.com/login?ref=VTX-AB2C' } },
  ]);
  assert.deepEqual(kb[1], [{ text: 'Share', url: 'https://t.me/share/url?url=' + encodeURIComponent('https://t.me/vertexhashbot?start=VTX-AB2C') }]);
  assert.equal(kb[2][0].web_app.url, cfg.appUrl);
});

test('/referrals: no VIP line at VIP 0, and a odd code is not shown', async () => {
  answer = good({ code: 'VTX-AB2C', friends: 0, active: 0, earned: 0, vip: 0 });
  await say('/referrals');
  assert.equal(sent[0].text, 'Your code: VTX-AB2C\nFriends: 0 (0 active)\nEarned: 0.00000000 BTC');
  sent.length = 0;
  answer = good({ code: 'x y<>', friends: 0, active: 0, earned: 0, vip: 0 });
  await say('/referrals');
  assert.equal(sent[0].text, 'Friends: 0 (0 active)\nEarned: 0.00000000 BTC');
  assert.equal(sent[0].extra.reply_markup.inline_keyboard.length, 1);
  assert.ok(sent[0].extra.reply_markup.inline_keyboard[0][0].web_app);
});

test('no account: message and Open app button, for both commands', async () => {
  answer = { ok: false, status: 404, json: { ok: false, error: 'No account.' } };
  for (const c of ['/earnings', '/referrals']) {
    sent.length = 0;
    await say(c);
    assert.equal(sent[0].text, 'No account found. Open the app first.');
    assert.equal(sent[0].extra.reply_markup.inline_keyboard[0][0].web_app.url, cfg.appUrl);
  }
});

test('app down, switched off or odd answer: Try again in a minute', async () => {
  for (const c of ['/earnings', '/referrals']) {
    for (const a of [
      { ok: false, status: 0, json: null },
      { ok: false, status: 503, json: { ok: false } },
      good({ miners: 'yes', today: 1, total: 1 }),
      good({ code: 'VTX-AB2C', friends: 'x', active: 0, earned: 0, vip: 0 }),
    ]) {
      answer = a;
      sent.length = 0;
      await say(c);
      assert.equal(sent[0].text, 'Try again in a minute.');
    }
  }
});

test('the menu lists both commands and the texts exist in en and fa', () => {
  const cmds = commandList('en');
  assert.ok(cmds.some((c) => c.command === 'earnings' && c.description === 'Show earnings'));
  assert.ok(cmds.some((c) => c.command === 'referrals' && c.description === 'Invite friends'));
  for (const k of ['earnToday', 'earnTotal', 'earnAvg', 'noMiners', 'refCode', 'refFriends', 'refEarned', 'refVip', 'd_earnings', 'd_referrals', 'b_copyCode', 'b_copyLink', 'b_share']) assert.ok(texts.en[k] && texts.fa[k], `${k} missing`);
  assert.equal(t('fa', 'd_referrals'), 'دعوت دوستان');
});
