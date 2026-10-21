import test from 'node:test';
import assert from 'node:assert/strict';
import { grossPerUnit, ratioOf, pickCoin, dailyUsd, HYSTERESIS } from '@/lib/smart';

test('grossPerUnit: reward x blocks per day x price x unit / nethash', () => {
  // 10 coins a block, a block every 60 s (1440 a day), $2 a coin, network 1e12 H/s, one unit = 1e6 H/s (MH/s)
  const g = grossPerUnit({ price: 2, nethash: 1e12, reward: 10, blockTime: 60, unit: 'MH/s' });
  assert.ok(Math.abs(g - 10 * 1440 * 2 * 1e6 / 1e12) < 1e-12);
});

test('grossPerUnit: missing or bad inputs give null', () => {
  const ok = { price: 2, nethash: 1e12, reward: 10, blockTime: 60, unit: 'MH/s' };
  assert.equal(grossPerUnit({ ...ok, price: 0 }), null);
  assert.equal(grossPerUnit({ ...ok, nethash: undefined }), null);
  assert.equal(grossPerUnit({ ...ok, blockTime: -1 }), null);
  assert.equal(grossPerUnit({ ...ok, unit: 'PH/s' }), null);
});

test('ratioOf: 1 is as priced, null when either side is missing', () => {
  assert.equal(ratioOf(1.2, 1), 1.2);
  assert.equal(ratioOf(1, 1), 1);
  assert.equal(ratioOf(null, 1), null);
  assert.equal(ratioOf(1, null), null);
  assert.equal(ratioOf(0, 1), null);
});

test('pickCoin: the best ratio wins when there is no previous coin', () => {
  assert.equal(pickCoin({ BTC: 1, KAS: 1.2, RVN: 0.9, XMR: 1.1 }), 'KAS');
});

test('pickCoin: the previous coin stays inside the hysteresis, and changes beyond it', () => {
  const small = 1 + HYSTERESIS / 2;
  const big = 1 + HYSTERESIS * 2;
  assert.equal(pickCoin({ BTC: 1, KAS: small }, 'BTC'), 'BTC');
  assert.equal(pickCoin({ BTC: 1, KAS: big }, 'BTC'), 'KAS');
});

test('pickCoin: a coin without data is never picked, and the previous coin without data does not hold', () => {
  assert.equal(pickCoin({ BTC: 1, KAS: null, RVN: 0.8 }), 'BTC');
  assert.equal(pickCoin({ BTC: null, KAS: 1.01 }, 'BTC'), 'KAS');
});

test('pickCoin: no usable coin gives null', () => {
  assert.equal(pickCoin({ BTC: null, KAS: null }), null);
  assert.equal(pickCoin({}), null);
  assert.equal(pickCoin(undefined), null);
});

test('pickCoin: ASIC-only choice stays BTC', () => {
  assert.equal(pickCoin({ BTC: 1.3 }, 'BTC'), 'BTC');
});

test('dailyUsd: budget x base yield x ratio, never negative or NaN', () => {
  assert.ok(Math.abs(dailyUsd(1000, 0.01, 1.2) - 12) < 1e-9);
  assert.equal(dailyUsd(1000, 0.01), 10);
  assert.equal(dailyUsd(0, 0.01, 1), 0);
  assert.equal(dailyUsd(1000, NaN, 1), 0);
  assert.equal(dailyUsd(1000, 0.01, -1), 0);
});
