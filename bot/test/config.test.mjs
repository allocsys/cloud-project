import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config, checkConfig } from '../src/config.js';
import { texts, hasLang, t, helpText } from '../src/texts.js';

const good = {
  BOT_TOKEN: '12345:' + 'a'.repeat(30),
  BOT_WEBHOOK_PATH: 'p'.repeat(20),
  BOT_WEBHOOK_SECRET: 's'.repeat(20),
  APP_URL: 'https://vertexhash.com/',
};

test('a good setup passes and the trailing slash is dropped', () => {
  const c = config(good);
  assert.equal(c.appUrl, 'https://vertexhash.com');
  assert.doesNotThrow(() => checkConfig(c));
});

test('weak or missing settings stop the boot and the error never shows a value', () => {
  for (const [k, v] of [
    ['BOT_TOKEN', 'nope'],
    ['BOT_WEBHOOK_PATH', 'short'],
    ['BOT_WEBHOOK_SECRET', 'has space in it........'],
    ['APP_URL', 'http://vertexhash.com'],
    ['APP_URL', 'https://vertexhash.com/path'],
  ]) {
    assert.throws(() => checkConfig(config({ ...good, [k]: v })), (e) => e.message.includes(k.split(' ')[0]) && !e.message.includes(String(v)));
  }
  assert.throws(() => checkConfig(config({ ...good, BOT_WEBHOOK_SECRET: good.BOT_WEBHOOK_PATH })), /must differ/);
  assert.equal(config(good).botUsername, 'vertexhashbot');
  assert.throws(() => checkConfig(config({ ...good, BOT_USERNAME: 'bad name!' })), /BOT_USERNAME/);
});

test('every fa key exists in en with the same placeholders', () => {
  for (const k of Object.keys(texts.fa)) {
    assert.ok(k in texts.en, `fa key ${k} missing in en`);
    const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
    assert.equal(ph(texts.fa[k]), ph(texts.en[k]), `placeholders differ for ${k}`);
  }
});

test('notification texts exist in en and fa and fill their values', () => {
  for (const k of ['n_depPaid', 'n_wdSent', 'n_vipDrop']) {
    assert.ok(texts.en[k] && texts.fa[k], `${k} missing`);
  }
  assert.equal(t('en', 'n_depPaid', { usd: '50.00' }), 'Deposit received: $50.00.');
  assert.equal(t('fa', 'n_depPaid', { usd: '50.00' }), 'واریز شد: $50.00.');
  assert.equal(t('en', 'n_wdSent', { amt: '0.5 BTC' }), 'Withdrawal sent: 0.5 BTC.');
  assert.equal(t('en', 'n_vipDrop', { n: 2, date: '30 Nov' }), 'VIP 2 drops on 30 Nov.');
  assert.ok(t('fa', 'n_vipDrop', { n: 2, date: 'x' }).includes('VIP 2'));
});

test('texts fall back to English and fill placeholders', () => {
  assert.equal(hasLang('en'), true);
  assert.equal(t('fa', 'open'), hasLang('fa') ? texts.fa.open : texts.en.open);
  assert.equal(t('en', 'support', { email: 'a@b.c' }), 'Need help? Write to a@b.c.');
  assert.ok(helpText('en').split('\n').every((l) => l.startsWith('/')));
});
