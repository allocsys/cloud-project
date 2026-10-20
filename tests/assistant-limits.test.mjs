import test from 'node:test';
import assert from 'node:assert/strict';
import { takeAnswer, giveBack, answersLeft } from '../lib/assistant-limits.js';

const fresh = () => ({ day: '', users: new Map(), total: 0 });
const L = { user: 3, global: 5 };
const DAY1 = Date.parse('2026-10-20T10:00:00Z');
const DAY2 = Date.parse('2026-10-21T00:00:01Z');

test('a user gets the daily number of answers, then is stopped', () => {
  const store = fresh();
  const o = { now: DAY1, store, limits: L };
  assert.deepEqual(takeAnswer('a', o), { ok: true, left: 2 });
  assert.deepEqual(takeAnswer('a', o), { ok: true, left: 1 });
  assert.deepEqual(takeAnswer('a', o), { ok: true, left: 0 });
  assert.deepEqual(takeAnswer('a', o), { ok: false, left: 0 });
  assert.equal(answersLeft('a', o), 0);
});

test('one user running out does not affect another', () => {
  const store = fresh();
  const o = { now: DAY1, store, limits: L };
  for (let i = 0; i < 3; i += 1) takeAnswer('a', o);
  assert.equal(takeAnswer('b', o).ok, true);
});

test('the global cap stops everyone', () => {
  const store = fresh();
  const o = { now: DAY1, store, limits: L };
  takeAnswer('a', o);
  takeAnswer('a', o);
  takeAnswer('b', o);
  takeAnswer('b', o);
  takeAnswer('c', o); // 5th of 5
  assert.equal(takeAnswer('d', o).ok, false);
  assert.equal(answersLeft('d', o), 3);
});

test('counters reset on the next UTC day', () => {
  const store = fresh();
  for (let i = 0; i < 3; i += 1) takeAnswer('a', { now: DAY1, store, limits: L });
  assert.equal(takeAnswer('a', { now: DAY1, store, limits: L }).ok, false);
  assert.deepEqual(takeAnswer('a', { now: DAY2, store, limits: L }), { ok: true, left: 2 });
});

test('giveBack returns a reserved answer and never goes below zero', () => {
  const store = fresh();
  const o = { now: DAY1, store, limits: L };
  takeAnswer('a', o);
  giveBack('a', o);
  assert.equal(answersLeft('a', o), 3);
  giveBack('a', o);
  assert.equal(answersLeft('a', o), 3);
  assert.equal(store.total, 0);
});
