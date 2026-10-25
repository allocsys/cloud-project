import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LANG, LANGS, pickLang, translate } from '@/lib/i18n/langs';

const holes = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join();

test('every language has a name, a direction and messages', () => {
  for (const [code, l] of Object.entries(LANGS)) {
    assert.ok(l.name, code);
    assert.ok(l.dir === 'ltr' || l.dir === 'rtl', code);
    assert.equal(typeof l.messages, 'object', code);
  }
  assert.ok(LANGS[DEFAULT_LANG]);
});

test('no language has a key English lacks, and placeholders match', () => {
  const en = LANGS[DEFAULT_LANG].messages;
  for (const [code, l] of Object.entries(LANGS)) {
    for (const [k, v] of Object.entries(l.messages)) {
      assert.ok(k in en, `${code}: unknown key ${k}`);
      assert.equal(typeof v, 'string', `${code}: ${k} is not text`);
      assert.equal(holes(v), holes(en[k]), `${code}: placeholders differ in ${k}`);
    }
  }
});

test('a missing key falls back to English, then to the key', () => {
  assert.equal(translate('fa', 'no.such.key'), 'no.such.key');
  assert.equal(translate('xx', 'settings.language'), translate('en', 'settings.language'));
});

test('placeholders are filled and unknown ones stay', () => {
  const orig = LANGS.en.messages['test.hello'];
  LANGS.en.messages['test.hello'] = 'Hi {name}, {n} left, {x}';
  try {
    assert.equal(translate('en', 'test.hello', { name: 'Ali', n: 0 }), 'Hi Ali, 0 left, {x}');
  } finally {
    if (orig === undefined) delete LANGS.en.messages['test.hello'];
    else LANGS.en.messages['test.hello'] = orig;
  }
});

test('pickLang only accepts known languages', () => {
  assert.equal(pickLang('fa'), 'fa');
  assert.equal(pickLang('xx'), DEFAULT_LANG);
  assert.equal(pickLang(undefined), DEFAULT_LANG);
  assert.equal(pickLang('constructor'), DEFAULT_LANG);
});
