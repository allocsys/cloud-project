import test from 'node:test';
import assert from 'node:assert/strict';
import { faqTr } from '@/lib/i18n/faq';
import { answerQuestion, SUPPORT_TEXT, EMPTY_TEXT } from '../lib/assistant.js';
import { faqList } from '../lib/faq.js';

const tr = (key, vars) => faqTr('fa', key, vars);

test('withdrawal time: with and without a request, and an unknown status stays English', async () => {
  const q = 'how long does a withdrawal take';
  const none = await answerQuestion(q, { tr, ctx: { withdrawals: [] } });
  assert.match(none.text, /^\u0628\u0631\u062f\u0627\u0634\u062a/);
  const one = await answerQuestion(q, { tr, ctx: { withdrawals: [{ id: 'AB12CD', status: 'sent to your wallet' }] } });
  assert.ok(one.text.includes('#AB12CD') && !one.text.includes('{'));
  const odd = await answerQuestion(q, { tr, ctx: { withdrawals: [{ id: 'AB12CD', status: 'pending review' }] } });
  assert.match(odd.text, /pending review/);
});

test('fee and refund answers carry their numbers', async () => {
  const f = await answerQuestion('is there a fee for withdrawing', { tr });
  assert.ok(!f.text.includes('{'), f.text);
  const r = await answerQuestion('can I get a refund', { tr });
  assert.ok(r.text.includes('24') && !r.text.includes('{'), r.text);
});

test('every FAQ entry has a Persian question and answer', () => {
  for (const e of faqList()) {
    assert.ok(faqTr('fa', `${e.id}.q`), `${e.id}.q`);
    assert.ok(faqTr('fa', `${e.id}.a`, { n: 1, id: 1, p: 'x', st: 'x', h: 1, a: 1, b: 1, d1: 1, d2: 1, d3: 1 }), `${e.id}.a`);
  }
});

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
  assert.match(r.text, /^ماینینگ هوشمند/);
  assert.ok(!(await answerQuestion('how does the smart mining reserve work', { tr })).text.includes('{'));
  assert.notEqual((await answerQuestion('zzz qqq', { tr })).text, SUPPORT_TEXT);
  assert.notEqual((await answerQuestion('', { tr })).text, EMPTY_TEXT);
  assert.equal((await answerQuestion('zzz qqq', {})).text, SUPPORT_TEXT);
});
