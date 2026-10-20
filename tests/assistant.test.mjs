import test from 'node:test';
import assert from 'node:assert/strict';
import { answerQuestion, SUPPORT_TEXT, EMPTY_TEXT, MAX_QUESTION } from '../lib/assistant.js';

const HIGH = 'how do I reinvest';          // high confidence FAQ match
const MEDIUM = 'withdrawal pending';        // medium match with a close second
const NONE = 'what is the weather today';   // no FAQ match

function spy(reply) {
  const fn = async (...args) => {
    fn.calls.push(args);
    if (reply instanceof Error) throw reply;
    return reply;
  };
  fn.calls = [];
  return fn;
}

test('high confidence answers from the FAQ and never calls the LLM', async () => {
  const llm = spy('should not be used');
  const r = await answerQuestion(HIGH, { llm });
  assert.equal(r.source, 'faq');
  assert.match(r.text, /covers a plan/);
  assert.equal(llm.calls.length, 0);
});

test('live placeholders reach the FAQ answer', async () => {
  const r = await answerQuestion(HIGH, { ctx: { pick: { plan: { id: 'basic' } } } });
  assert.equal(r.source, 'faq');
  assert.match(r.text, /basic/);
});

test('medium match goes to the LLM when available', async () => {
  const llm = spy('  Here is a helpful answer.  ');
  const r = await answerQuestion(MEDIUM, { llm, ctx: { x: 1 } });
  assert.equal(r.source, 'llm');
  assert.equal(r.text, 'Here is a helpful answer.');
  assert.equal(llm.calls.length, 1);
  const [q, match, ctx] = llm.calls[0];
  assert.equal(q, MEDIUM);
  assert.equal(match.level, 'medium');
  assert.deepEqual(ctx, { x: 1 });
});

test('no FAQ match goes to the LLM when available', async () => {
  const r = await answerQuestion(NONE, { llm: spy('Sorry, I only help with Miner Opus.') });
  assert.equal(r.source, 'llm');
});

test('LLM throws: medium match becomes a labelled guess with a Did you mean chip', async () => {
  const r = await answerQuestion(MEDIUM, { llm: spy(new Error('down')) });
  assert.equal(r.source, 'faq-guess');
  assert.ok(r.text.length > 10);
  assert.equal(r.did.id, 'withdraw_time');
});

test('LLM throws: no match points to support', async () => {
  const r = await answerQuestion(NONE, { llm: spy(new Error('down')) });
  assert.equal(r.source, 'support');
  assert.equal(r.text, SUPPORT_TEXT);
});

test('LLM returns null (limit reached): falls back like a down LLM', async () => {
  assert.equal((await answerQuestion(NONE, { llm: spy(null) })).source, 'support');
  assert.equal((await answerQuestion(MEDIUM, { llm: spy('') })).source, 'faq-guess');
});

test('no LLM configured behaves like a down LLM', async () => {
  assert.equal((await answerQuestion(NONE)).source, 'support');
  assert.equal((await answerQuestion(MEDIUM)).source, 'faq-guess');
  assert.equal((await answerQuestion(HIGH)).source, 'faq');
});

test('a slow LLM times out and falls back', async () => {
  const slow = () => new Promise(() => {});
  const r = await answerQuestion(NONE, { llm: slow, timeoutMs: 20 });
  assert.equal(r.source, 'support');
});

test('unsafe LLM replies are dropped', async () => {
  for (const bad of [
    'This plan has guaranteed profit.',
    'It is risk-free.',
    'You will double your money.',
    'Our AI boosts mining output.',
    'AI-optimized returns every day.',
  ]) {
    const r = await answerQuestion(NONE, { llm: spy(bad) });
    assert.equal(r.source, 'support', bad);
  }
});

test('plain risk wording is not blocked', async () => {
  const r = await answerQuestion(NONE, { llm: spy('Returns are not guaranteed and you can lose money.') });
  assert.equal(r.source, 'llm');
});

test('empty and whitespace questions never reach the LLM', async () => {
  const llm = spy('x');
  for (const q of ['', '   ', null, undefined]) {
    const r = await answerQuestion(q, { llm });
    assert.equal(r.source, 'support');
    assert.equal(r.text, EMPTY_TEXT);
  }
  assert.equal(llm.calls.length, 0);
});

test('long questions are trimmed before the LLM sees them', async () => {
  const llm = spy('ok');
  await answerQuestion('weather '.repeat(500), { llm });
  assert.ok(llm.calls[0][0].length <= MAX_QUESTION);
});
