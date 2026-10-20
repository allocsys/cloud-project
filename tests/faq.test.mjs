import test from 'node:test';
import assert from 'node:assert/strict';
import { matchFaq, faqList, faqAnswer, tokens, FAQ_APPROVED } from '../lib/faq.js';

const CASES = [
  ['How do I deposit money?', 'deposit'],
  ['I want to top up my balance', 'deposit'],
  ['my deposit is still pending', 'deposit_confirm'],
  ['how do I withdraw', 'withdraw_how'],
  ['how do i cash out?', 'withdraw_how'],
  ['how long does a withdrawal take', 'withdraw_time'],
  ['where is my payout, it is pending review', 'withdraw_time'],
  ['I cant widthdraw my money', 'withdraw_how'],
  ['what plans do you have', 'plans'],
  ['how long does my plan run', 'plan_duration'],
  ['when does a plan expire', 'plan_duration'],
  ['how are earnings calculated', 'earnings_how'],
  ['why did my earnings drop', 'earnings_change'],
  ['is it guaranteed? can I lose money', 'returns'],
  ['how do I reinvest my balance', 'reinvest'],
  ['I did not get the verification email', 'verify_email'],
  ['does it work in telegram', 'telegram'],
  ['is my account secure', 'security'],
  ['any hidden fees?', 'fees'],
  ['how do I contact support', 'support'],
  ['i forgot my password', 'password'],
  ['which networks do you accept', 'networks'],
  ['can I pay with a card', 'pay_method'],
  ['how do I create an account', 'register'],
  ['how do I sign up', 'register'],
  ['how do I close my account', 'close_account'],
  ['delete my account', 'close_account'],
  ['how do I turn on 2fa', 'twofa'],
  ['what is the demo', 'demo'],
  ['do you have an invite code', 'invite'],
  ['what is my miner id', 'miner_id'],
  ['who pays for electricity', 'electricity'],
  ['do I need hardware', 'hardware'],
  ['can I get a refund', 'refund'],
  ['what is a sat', 'units'],
  ['where is the notification bell', 'notifications'],
  ['when is the next payout', 'earn_timing'],
  ['what is the minimum withdrawal', 'withdraw_min'],
  ['what is the minimum deposit', 'deposit_min'],
  ['can I withdraw small amounts', 'low_min'],
  ['what is the lowest deposit', 'deposit_min'],
  ['lowest deposit', 'deposit_min'],
  ['smallest withdrawal', 'withdraw_min'],
];

for (const [q, id] of CASES) {
  test(`"${q}" -> ${id}`, () => {
    const r = matchFaq(q);
    assert.notEqual(r.level, 'none', `no match, score ${r.score}`);
    assert.equal(r.id, id, `got ${r.id} (${r.score})`);
  });
}

const OFF = [
  'what is the weather today',
  'tell me a joke',
  'who won the football game',
  'hello',
  '',
  '???',
  'recipe for pancakes',
];
for (const q of OFF) {
  test(`off-topic "${q}" falls through`, () => {
    assert.equal(matchFaq(q).level, 'none');
  });
}

test('typos are corrected', () => {
  assert.ok(tokens('widthdraw').includes('withdraw'));
  assert.ok(tokens('depositt').includes('deposit'));
});

test('synonyms and stems collapse', () => {
  assert.deepEqual(tokens('withdrawals'), tokens('payout'));
  assert.deepEqual(tokens('earnings'), tokens('profit'));
});

test('negative words rule an entry out', () => {
  assert.notEqual(matchFaq('how do I withdraw my deposit').id, 'deposit');
});

test('live placeholders: withdrawal status and reinvest pick', () => {
  const w = matchFaq('how long does a withdrawal take', { withdrawals: [{ id: 12, status: 'pending review' }] });
  assert.match(w.answer, /\(#12\) is pending review/);
  const r = matchFaq('how do I reinvest', { pick: { plan: { id: 'basic' } } });
  assert.match(r.answer, /basic/);
  assert.match(matchFaq('how do I reinvest').answer, /covers a plan/);
});

test('"Did you mean" offers a close second on a medium match', () => {
  const r = matchFaq('withdrawal pending');
  assert.equal(r.level, 'medium');
  assert.equal(r.did.id, 'withdraw_time');
  assert.equal(matchFaq('how do I withdraw').did, null);
});

test('no return promises in any answer', () => {
  for (const { id } of faqList()) {
    const a = faqAnswer(id, {});
    assert.ok(a && a.length > 10, id);
    assert.doesNotMatch(a, /guaranteed profit|risk-free|will earn|double your/i, id);
  }
});

test('answers are still drafts until approved', () => {
  assert.equal(FAQ_APPROVED, false);
});

test('unknown id', () => {
  assert.equal(faqAnswer('nope'), null);
});
