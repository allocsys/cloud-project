import test from 'node:test';
import assert from 'node:assert/strict';
import { grossPerUnit, ratioOf, pickCoin, dailyUsd, HYSTERESIS, smartDaily, SMART_FLAT_FROM, smartSeries, smartBaseYield, anchorOn, anchorFor, bestNet, seedOf, ANCHOR_FROM, ANCHOR_FLOOR } from '@/lib/smart';

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

// A $50, 90 day plan at 0.21% a day.
const plan = { budget: 50, days: 90, baseYield: smartBaseYield(90, 0.0021) };
const DAY_MS = 86400000;

test('dailyUsd with days: the principal share is flat, only the profit follows the ratio', () => {
  const share = 50 / 90;
  assert.ok(Math.abs(dailyUsd(50, plan.baseYield, 1, 90) - 50 * plan.baseYield) < 1e-9);
  assert.ok(Math.abs(dailyUsd(50, plan.baseYield, 0, 90) - share) < 1e-9);
  assert.ok(Math.abs(dailyUsd(50, plan.baseYield, 2, 90) - (share + 50 * 0.0021 * 2)) < 1e-9);
  assert.equal(dailyUsd(50, plan.baseYield, -1, 90), 0);
  assert.equal(dailyUsd(0, plan.baseYield, 1, 90), 0);
});

test('dailyUsd with days: a weak market still pays back more than the principal share', () => {
  assert.ok(dailyUsd(50, plan.baseYield, 0.8, 90) > 50 / 90);
  assert.ok(dailyUsd(50, plan.baseYield, 0.8, 90) > dailyUsd(50, plan.baseYield, 0.8));
});

test('smartDaily: days before 27 Oct 2026 keep the old rule, from that day the new one', () => {
  assert.ok(Math.abs(smartDaily(plan, 1.2, SMART_FLAT_FROM - DAY_MS) - 50 * plan.baseYield * 1.2) < 1e-9);
  assert.ok(Math.abs(smartDaily(plan, 1.2, SMART_FLAT_FROM) - dailyUsd(50, plan.baseYield, 1.2, 90)) < 1e-9);
  assert.ok(smartDaily(plan, 1.2, SMART_FLAT_FROM) < smartDaily(plan, 1.2, SMART_FLAT_FROM - DAY_MS));
});

test('smartSeries: a flat-rule term at ratio 1.59 earns 15.03 profit on $50 (no reserve)', () => {
  const n = 90;
  const s = smartSeries(plan, Array(n).fill(1.59), null, null, Array(n).fill(true));
  const total = s.days.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - (50 + 50 * 0.0021 * 90 * 1.59)) < 1e-6);
});

test('smartSeries: flat days at ratio 0 return the principal and no profit (no reserve)', () => {
  const n = 90;
  const s = smartSeries(plan, Array(n).fill(0), null, null, Array(n).fill(true));
  assert.ok(Math.abs(s.days.reduce((a, b) => a + b, 0) - 50) < 1e-6);
});

test('smartSeries: old-rule days (no flat flag) are paid as before', () => {
  const s = smartSeries(plan, [1.2, 0.8]);
  assert.ok(Math.abs(s.days[0] - 50 * plan.baseYield * 1.2) < 1e-9);
  assert.ok(Math.abs(s.days[1] - 50 * plan.baseYield * 0.8) < 1e-9);
});

test('smartSeries: with a reserve, flat days keep the principal share and clip only the profit', () => {
  const c = { ...plan, reserve: { lo: 0.0021 * 0.7, hi: 0.0021 * 1.3, seed: 1, userShare: 0.5 } };
  const s = smartSeries(c, [3], null, null, [true]);
  assert.ok(Math.abs(s.days[0] - (50 / 90 + 50 * 0.0021 * 1.3)) < 1e-9);
  assert.ok(s.left > 1);
});

const D = 86400000;
const flatDays = (from, n, nets) => Object.fromEntries(Array.from({ length: n }, (_, i) => [from + i * D, nets]));

test('bestNet: the highest net, 0 when every coin loses', () => {
  assert.equal(bestNet({ BTC: 1.3, KAS: 1.6, RVN: -0.5 }), 1.6);
  assert.equal(bestNet({ BTC: -1, KAS: -2 }), 0);
  assert.equal(bestNet({}), 0);
});

test('anchorOn: before 28 Oct it is the seed, so old days keep their meaning', () => {
  assert.equal(anchorOn(ANCHOR_FROM - D, flatDays(ANCHOR_FROM - 40 * D, 40, { KAS: 5 }), 1.43), 1.43);
  assert.equal(anchorOn(SMART_FLAT_FROM, {}, 1.43), 1.43);
});

test('anchorOn: from 28 Oct it is the average of the best coin over the 30 finished days before', () => {
  const days = flatDays(ANCHOR_FROM - 30 * D, 30, { BTC: 1, KAS: 2 });
  assert.equal(anchorOn(ANCHOR_FROM, days, 1.43), 2);
});

test('anchorOn: days with no data count as the seed, so a young history moves it gently', () => {
  const days = flatDays(ANCHOR_FROM - 3 * D, 3, { KAS: 3 });
  const a = anchorOn(ANCHOR_FROM, days, 1.43);
  assert.ok(Math.abs(a - (3 * 3 + 27 * 1.43) / 30) < 1e-9);
});

test('anchorOn: never below the floor, and a losing day counts as 0', () => {
  const days = flatDays(ANCHOR_FROM - 30 * D, 30, { BTC: -1, KAS: -2 });
  assert.equal(anchorOn(ANCHOR_FROM, days, 1.43), ANCHOR_FLOOR);
});

test('anchorOn: a finished day never changes when later days arrive; the day itself is not counted', () => {
  const days = flatDays(ANCHOR_FROM - 30 * D, 30, { KAS: 2 });
  const before = anchorOn(ANCHOR_FROM, days, 1.43);
  days[ANCHOR_FROM] = { KAS: 99 };
  days[ANCHOR_FROM + D] = { KAS: 99 };
  assert.equal(anchorOn(ANCHOR_FROM, days, 1.43), before);
});

test('anchorOn: no seed, no anchor', () => {
  assert.equal(anchorOn(ANCHOR_FROM, {}, null), null);
  assert.equal(seedOf({}), null);
  assert.equal(seedOf({ BTC: 1.43, KAS: 1.43 }), 1.43);
});

test('anchorFor: reads the seed from refs and follows anchorOn', () => {
  const sm = { refs: { BTC: 1.43, KAS: 1.43 }, days: flatDays(ANCHOR_FROM - 30 * D, 30, { KAS: 2 }) };
  assert.equal(anchorFor(sm, ANCHOR_FROM - D), 1.43);
  assert.equal(anchorFor(sm, ANCHOR_FROM), 2);
  assert.equal(anchorFor({ refs: {}, days: {} }, ANCHOR_FROM), null);
});
