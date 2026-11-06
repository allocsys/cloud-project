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
});

test('every fa key exists in en with the same placeholders', () => {
  for (const k of Object.keys(texts.fa)) {
    assert.ok(k in texts.en, `fa key ${k} missing in en`);
    const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
    assert.equal(ph(texts.fa[k]), ph(texts.en[k]), `placeholders differ for ${k}`);
  }
});

test('texts fall back to English and fill placeholders', () => {
  assert.equal(hasLang('en'), true);
  assert.equal(t('fa', 'open'), hasLang('fa') ? texts.fa.open : texts.en.open);
  assert.equal(t('en', 'support', { email: 'a@b.c' }), 'Need help? Write to a@b.c.');
  assert.ok(helpText('en').split('\n').every((l) => l.startsWith('/')));
});
