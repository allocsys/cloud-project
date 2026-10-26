import test from 'node:test';
import assert from 'node:assert/strict';
import { SMART, SMART_BUDGETS, SMART_RATES, SMART_BONUS, smartBaseYield, smartPayout, normalizeSmartTable, smartPlan, smartSeries, smartSettle, resolveSmart } from '../lib/smart.js';

const near = (a, b, e = 0.01) => assert.ok(Math.abs(a - b) <= e, `${a} vs ${b}`);
const flat = (n, r) => Array.from({ length: n }, () => r);
const total = (c, ratios) => smartSeries(c, ratios).days.reduce((s, v) => s + v, 0);
const P = 0.003; // a flat 0.3% a day, so the maths below stays easy to follow

test('terms are 90, 120, 150 and 180 days', () => {
  assert.deepEqual(SMART.terms, [90, 120, 150, 180]);
  assert.equal(resolveSmart({ budget: 100, days: 365 }), null);
  assert.ok(resolveSmart({ budget: 100, days: 120 }));
  assert.ok(resolveSmart({ budget: 100, days: 180 }));
});

test('0.3% a day net: $100 pays back 127, 136, 145 and 154', () => {
  for (const [days, back] of [[90, 127], [120, 136], [150, 145], [180, 154]]) {
    near(100 * smartBaseYield(days, P) * days, back);
  }
});

test('a payout outside the range falls back to the default', () => {
  assert.equal(smartBaseYield(90, 1.06), smartBaseYield(90));
});

test('the pay table: waypoints, interpolation on the log of the budget, flat above the last', () => {
  assert.equal(SMART_BUDGETS.length, SMART_RATES.length);
  assert.equal(SMART_BUDGETS[0], SMART.min);
  assert.equal(SMART_BUDGETS[SMART_BUDGETS.length - 1], SMART.max);
  SMART_BUDGETS.forEach((b, i) => near(smartPayout(b, 90), SMART_RATES[i], 1e-9));
  near(smartPayout(70, 90), 0.00222, 1e-5); // between $50 (0.21%) and $100 (0.235%)
  assert.ok(smartPayout(70, 90) > smartPayout(50, 90) && smartPayout(70, 90) < smartPayout(100, 90));
  near(smartPayout(20000, 90), 0.004, 1e-9);
  near(smartPayout(10, 90), 0.0021, 1e-9);
});

test('the term bonus: +0.01pp on 120 days, +0.02pp on 150 days, +0.03pp on 180 days', () => {
  near(smartPayout(500, 90), 0.00295, 1e-9);
  near(smartPayout(500, 120), 0.00305, 1e-9);
  near(smartPayout(500, 150), 0.00315, 1e-9);
  near(smartPayout(500, 180), 0.00325, 1e-9);
  near(smartPayout(10000, 150), 0.0042, 1e-9);
  near(smartPayout(10000, 180), 0.0043, 1e-9);
  // $50 on 90 days: 18.9% profit; $10,000 on 150 days: 63% profit; $10,000 on 180 days: 77.4% profit
  near(smartPayout(50, 90) * 90, 0.189, 1e-9);
  near(smartPayout(10000, 150) * 150, 0.63, 1e-9);
  near(smartPayout(10000, 180) * 180, 0.774, 1e-9);
});

test('a payout is a multiple of 0.001% a day, and a bad table falls back to the defaults', () => {
  for (const b of [51, 77, 123, 999, 4321]) {
    const p = smartPayout(b, 120);
    near(Math.round(p * 1e5), p * 1e5, 1e-6);
  }
  assert.deepEqual(normalizeSmartTable(undefined), { rates: SMART_RATES, bonus: SMART_BONUS });
  assert.deepEqual(normalizeSmartTable({ rates: [0.003], bonus: { 120: 5 } }), { rates: SMART_RATES, bonus: SMART_BONUS });
  assert.deepEqual(normalizeSmartTable({ rates: SMART_RATES.map(() => 0.004), bonus: { 120: 0, 150: 0.001, 180: 0.002 } }), { rates: SMART_RATES.map(() => 0.004), bonus: { 90: 0, 120: 0, 150: 0.001, 180: 0.002 } });
  assert.equal(normalizeSmartTable({ rates: SMART_RATES, bonus: { 120: 0, 150: 0.001 } }).bonus[180], SMART_BONUS[180], 'a saved table with no 180 bonus takes the default');
  near(smartPayout(500, 150, { rates: SMART_RATES.map(() => 0.0099), bonus: { 120: 0, 150: 0.005 } }), SMART.payoutMax, 1e-9);
});

test('the plan carries the payout of its budget and term', () => {
  const p = smartPlan(500, 120);
  near(p.baseYield, smartBaseYield(120, 0.00305), 1e-12);
  const flatTable = { rates: SMART_RATES.map(() => 0.004), bonus: { 120: 0, 150: 0 } };
  near(smartPlan(100, 90, flatTable).baseYield, smartBaseYield(90, 0.004), 1e-12);
  near(resolveSmart({ budget: 100, days: 90 }, flatTable).baseYield, smartBaseYield(90, 0.004), 1e-12);
});

test('plan carries its reserve: band 30% either side of its payout, seed 2%, user share 50%', () => {
  const p = smartPlan(100, 90, P);
  near(p.reserve.lo, 0.0021, 1e-9);
  near(p.reserve.hi, 0.0039, 1e-9);
  assert.equal(p.reserve.seed, 2);
  assert.equal(p.reserve.userShare, 0.5);
  const big = smartPlan(10000, 90);
  near(big.reserve.lo, 0.004 * 0.7, 1e-9);
  near(big.reserve.hi, 0.004 * 1.3, 1e-9);
});

test('flat market pays as priced and nothing is left to split', () => {
  const p = smartPlan(100, 120, P);
  near(total(p, flat(120, 1)), 136);
  const s = smartSeries(p, flat(120, 1));
  near(s.left, 2);
  const e = smartSettle(p, s.left);
  near(e.user, 0);
  near(e.us, 2);
});

test('a strong market is capped per day and the excess is split at the end', () => {
  const p = smartPlan(100, 90, P);
  const s = smartSeries(p, flat(90, 1.4));
  near(Math.max(...s.days), 100 / 90 + 0.39);
  const e = smartSettle(p, s.left);
  near(total(p, flat(90, 1.4)) + e.user, 156.45, 0.05);
  near(e.us - 2, 21.35, 0.05);
});

test('a weak market is topped up from the reserve, never beyond it', () => {
  const p = smartPlan(100, 90, P);
  const s = smartSeries(p, flat(90, 0.6));
  assert.ok(s.left >= 0 && s.left < 1e-9);
  near(total(p, flat(90, 0.6)), 78.2, 0.05);
});

test('a rally first fills the reserve that covers the crash after it', () => {
  const p = smartPlan(100, 120, P);
  const ratios = [...flat(60, 1.4), ...flat(60, 0.6)];
  near(total(p, ratios), 136, 0.05);
});

test('a miner bought before the reserve existed pays as before', () => {
  const old = { budget: 100, days: 90, baseYield: 1.06 / 90 };
  const s = smartSeries(old, flat(90, 1));
  near(s.days.reduce((a, b) => a + b, 0), 106);
  assert.deepEqual(smartSettle(old, 0), { user: 0, us: 0 });
});
