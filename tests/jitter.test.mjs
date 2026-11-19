import test from 'node:test';
import assert from 'node:assert/strict';
import { jitterEvery } from '../lib/server/jitter.js';

test('jitterEvery runs repeatedly, keeps going after a failing round, and stops', async () => {
  let n = 0;
  const h = jitterEvery(async () => {
    n += 1;
    throw new Error('round failed');
  }, 10, 0.5);
  await new Promise((r) => setTimeout(r, 120));
  h.stop();
  const seen = n;
  assert.ok(seen >= 3, `ran ${seen} times`);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(n, seen, 'no more rounds after stop()');
});

test('jitterEvery gaps stay inside the spread', () => {
  const gaps = [];
  const real = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => {
    gaps.push(ms);
    return { unref() {} };
  };
  try {
    for (let i = 0; i < 200; i += 1) jitterEvery(() => {}, 1000, 0.2).stop();
  } finally {
    globalThis.setTimeout = real;
  }
  assert.ok(gaps.every((g) => g >= 800 && g <= 1200), 'every gap is 800-1200 ms');
  assert.ok(new Set(gaps).size > 20, 'gaps differ');
});
