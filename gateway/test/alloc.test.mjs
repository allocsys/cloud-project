// Pure tests for the unique-amount allocator. No database, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quantumRule, quantumAtomic, pickAmount } from '../src/alloc.js';

test('the step is a power of ten close to the USD step', () => {
  assert.equal(quantumAtomic(0.0001, 1, 6), 100n); // 0.0001 USDT with 6 decimals
  assert.equal(quantumAtomic(0.0002, 3000, 18), 10_000_000_000n); // 0.0002 USD of ETH is about 6.7e10 wei
  assert.equal(quantumAtomic(0.0002, 100000, 8), 1n); // below one satoshi: one satoshi
  assert.equal(quantumAtomic(0.0002, 0.1, 18), 1_000_000_000_000_000n);
});

test('stablecoins get a finer step and more slots', () => {
  assert.deepEqual(quantumRule('usdt'), { usd: 0.0001, slots: 100 });
  assert.deepEqual(quantumRule('usdc'), { usd: 0.0001, slots: 100 });
  assert.deepEqual(quantumRule('eth'), { usd: 0.0002, slots: 50 });
});

test('the amount is rounded up to the step and skips taken amounts', () => {
  assert.equal(pickAmount(50000n, 1n, new Set(), 50), 50000n);
  assert.equal(pickAmount(50000n, 1n, new Set(['50000']), 50), 50001n);
  assert.equal(pickAmount(50000n, 1n, new Set(['50000', '50001', '50003']), 50), 50002n);
  assert.equal(pickAmount(50050n, 100n, new Set(), 50), 50100n);
  assert.equal(pickAmount(50100n, 100n, new Set(['50100']), 50), 50200n);
});

test('no free slot gives null, and the result never goes below the base', () => {
  const taken = new Set(Array.from({ length: 5 }, (_, k) => String(1000 + k)));
  assert.equal(pickAmount(1000n, 1n, taken, 5), null);
  assert.ok(pickAmount(1234n, 100n, new Set(), 5) >= 1234n);
});
