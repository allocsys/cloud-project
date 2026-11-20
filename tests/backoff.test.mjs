import test from 'node:test';
import assert from 'node:assert/strict';
import { waiting, good, bad, failures } from '../lib/backoff.js';

const T0 = 1_000_000;

test('a failure makes background checks wait, a good answer clears it', () => {
  const k = 'k1';
  assert.equal(waiting(k, T0), false);
  bad(k, 0, T0, 0);
  assert.equal(waiting(k, T0 + 14_000), true);
  assert.equal(waiting(k, T0 + 15_001), false);
  good(k);
  assert.equal(failures(k), 0);
});

test('each failure doubles the wait, up to 5 minutes', () => {
  const k = 'k2';
  const waits = [];
  for (let i = 0; i < 7; i++) {
    bad(k, 0, T0, 0);
    let ms = 0;
    while (waiting(k, T0 + ms)) ms += 1000;
    waits.push(ms);
  }
  assert.deepEqual(waits, [15000, 30000, 60000, 120000, 240000, 300000, 300000]);
  good(k);
});

test('Retry-After is honoured when longer, and capped at 5 minutes', () => {
  const k = 'k3';
  bad(k, 120, T0, 0);
  assert.equal(waiting(k, T0 + 119_000), true);
  assert.equal(waiting(k, T0 + 120_001), false);
  good(k);
  bad(k, 9999, T0, 0);
  assert.equal(waiting(k, T0 + 299_000), true);
  assert.equal(waiting(k, T0 + 300_001), false);
  good(k);
});

test('the random spread adds at most a quarter', () => {
  const k = 'k4';
  bad(k, 0, T0, 0.999);
  assert.equal(waiting(k, T0 + 18_000), true);
  assert.equal(waiting(k, T0 + 18_800), false);
  good(k);
});

test('keys do not affect each other', () => {
  bad('a', 0, T0, 0);
  assert.equal(waiting('b', T0), false);
  good('a');
});
