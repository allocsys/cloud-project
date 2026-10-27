import test from 'node:test';
import assert from 'node:assert/strict';
import { translate } from '@/lib/i18n/langs';
import { noteTitle, noteBody, noteWhen } from '@/lib/i18n/notes';

const en = (k, v) => translate('en', k, v);
const fa = (k, v) => translate('fa', k, v);

test('a notification without a code stays as saved', () => {
  const n = { title: 'Hello', body: 'From an admin' };
  assert.equal(noteTitle(n, fa, 'fa'), 'Hello');
  assert.equal(noteBody(n, fa, 'fa'), 'From an admin');
});

test('English text from codes matches what the server saved', () => {
  const sent = { code: 'wdSent', vars: { amt: '0.5 BTC' } };
  assert.equal(noteTitle(sent, en, 'en'), 'Withdrawal sent');
  assert.equal(noteBody(sent, en, 'en'), '0.5 BTC was sent to your wallet');
  const live = { code: 'live', vars: { serial: 'OP-1', plan: 'Starter' } };
  assert.equal(noteTitle(live, en, 'en'), 'Starter miner is live');
  const refund = { code: 'refund', vars: { serial: 'OP-1', btc: '0.00100000', usd: '50.00', gift: true } };
  assert.equal(noteBody(refund, en, 'en'), 'OP-1 was refunded: 0.00100000 BTC ($50.00) is back in your balance. The welcome gift miner was removed with it.');
  assert.equal(noteBody({ code: 'refund', vars: { ...refund.vars, gift: false } }, en, 'en'), 'OP-1 was refunded: 0.00100000 BTC ($50.00) is back in your balance.');
});

test('paused and resumed build from parts', () => {
  const day = Date.UTC(2026, 9, 12);
  const p = { code: 'paused', vars: { who: 'many', n: 2, day, tail: 'zero' } };
  assert.equal(noteBody(p, en, 'en'), '2 of your Smart Mining plans were switched off on 12 Oct because that day would not have been profitable. It paid nothing and counts toward your term.');
  const h = { code: 'resumed', vars: { who: 'hall', name: 'Texas' } };
  assert.equal(noteBody(h, en, 'en'), 'Texas is mining again: it is profitable.');
  assert.equal(noteBody(h, fa, 'fa'), 'Texas دوباره ماینینگ می‌کند: سودآور است.');
});

test('Smart notices decided under the floor rule talk about market returns', () => {
  const day = Date.UTC(2026, 9, 28);
  const p = { code: 'paused', vars: { who: 'smart', floor: true, day, tail: 'extend' } };
  assert.equal(noteBody(p, en, 'en'), 'Smart Mining was switched off on 28 Oct because market returns were too low. It paid nothing and your term is extended by a day.');
  const r = { code: 'resumed', vars: { who: 'one', floor: true } };
  assert.equal(noteBody(r, en, 'en'), 'One of your Smart Mining plans is mining again: market returns have recovered.');
  assert.equal(noteBody({ ...p, vars: { ...p.vars, floor: false } }, en, 'en'), 'Smart Mining was switched off on 28 Oct because that day would not have been profitable. It paid nothing and your term is extended by a day.', 'older notices keep their text');
  for (const n of [p, r]) assert.ok(!noteBody(n, fa, 'fa').startsWith('note.'), 'Persian text exists');
});

test('account notifications from codes', () => {
  const rec = { code: 'recUsed', vars: { n: 7 } };
  assert.equal(noteBody(rec, en, 'en'), '7 left. Turn two-factor off and on again for a new set.');
  assert.match(noteBody(rec, fa, 'fa'), /^7 /);
  for (const code of ['pwChanged', 'pwReset', 'emailAdded', 'recUsed', 'tfOn', 'tfOff']) {
    assert.ok(!noteTitle({ code, vars: { n: 1 } }, fa, 'fa').startsWith('note.'));
    assert.ok(!noteBody({ code, vars: { n: 1 } }, fa, 'fa').startsWith('note.'));
  }
  assert.equal(noteTitle({ code: 'tfOn' }, en, 'en'), 'Two-factor is on');
});

test('Persian titles and times', () => {
  assert.equal(noteTitle({ code: 'wdFailed' }, fa, 'fa'), 'برداشت ناموفق بود');
  assert.equal(noteWhen({ when: '5m ago' }, fa, 'fa'), '5 دقیقه پیش');
  assert.equal(noteWhen({ when: '3h ago' }, en, 'en'), '3h ago');
  assert.equal(noteWhen({ when: 'Just now' }, fa, 'fa'), 'همین حالا');
});
