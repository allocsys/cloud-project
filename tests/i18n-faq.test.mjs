import test from 'node:test';
import assert from 'node:assert/strict';
import { faqTr } from '@/lib/i18n/faq';
import { answerQuestion, SUPPORT_TEXT, EMPTY_TEXT } from '../lib/assistant.js';
import { faqList } from '../lib/faq.js';

const tr = (key, vars) => faqTr('fa', key, vars);

test('faqTr returns null for unknown language, key or prototype names', () => {
  assert.equal(faqTr('en', 'deposit.a'), null);
  assert.equal(faqTr('fa', 'no.such'), null);
  assert.equal(faqTr('fa', 'constructor'), null);
});

test('every Persian key belongs to a real FAQ entry', () => {
  const ids = new Set(faqList().map((e) => e.id));
  for (const key of ['deposit.a', 'deposit_min.a', 'notifications.q', 'units.a']) assert.ok(ids.has(key.split('.')[0]), key);
});

test('a Persian answer replaces the English one, with its number', async () => {
  const r = await answerQuestion('what is the minimum deposit', { tr });
  assert.equal(r.source, 'faq');
  assert.match(r.text, /^حداقل واریز \d+/);
});

test('an entry without a Persian answer stays English, and fixed replies are translated', async () => {
  const r = await answerQuestion('what is smart mining', { tr });
  assert.equal(r.source, 'faq');
  assert.match(r.text, /^Smart Mining lets you/);
  assert.notEqual((await answerQuestion('zzz qqq', { tr })).text, SUPPORT_TEXT);
  assert.notEqual((await answerQuestion('', { tr })).text, EMPTY_TEXT);
  assert.equal((await answerQuestion('zzz qqq', {})).text, SUPPORT_TEXT);
});
