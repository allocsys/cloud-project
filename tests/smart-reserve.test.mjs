import test from 'node:test';
import assert from 'node:assert/strict';
import { SMART, smartBaseYield, smartPlan, smartSeries, smartSettle, resolveSmart } from '../lib/smart.js';

const near = (a, b, e = 0.01) => assert.ok(Math.abs(a - b) <= e, `${a} vs ${b}`);
const flat = (n, r) => Array.from({ length: n }, () => r);
const total = (c, ratios) => smartSeries(c, ratios).days.reduce((s, v) => s + v, 0);

test('terms are 90, 120 and 150 days', () => {
  assert.deepEqual(SMART.terms, [90, 120, 150]);
  assert.equal(resolveSmart({ budget: 100, days: 365 }), null);
  assert.ok(resolveSmart({ budget: 100, days: 120 }));
});

test('0.3% a day net: $100 pays back 127, 136 and 145', () => {
  for (const [days, back] of [[90, 127], [120, 136], [150, 145]]) {
    near(100 * smartBaseYield(days) * days, back);
  }
});

test('a payout outside the range falls back to the default', () => {
  assert.equal(smartBaseYield(90, 1.06), smartBaseYield(90));
});

test('plan carries its reserve: band 0.2-0.4%, seed 2%, user share 50%', () => {
  const p = smartPlan(100, 90);
  near(p.reserve.lo, 0.002, 1e-9);
  near(p.reserve.hi, 0.004, 1e-9);
  assert.equal(p.reserve.seed, 2);
  assert.equal(p.reserve.userShare, 0.5);
});

test('flat market pays as priced and nothing is left to split', () => {
  const p = smartPlan(100, 120);
  near(total(p, flat(120, 1)), 136);
  const s = smartSeries(p, flat(120, 1));
  near(s.left, 2);
  const e = smartSettle(p, s.left);
  near(e.user, 0);
  near(e.us, 2);
});

test('a strong market is capped per day and the excess is split at the end', () => {
  const p = smartPlan(100, 90);
  const s = smartSeries(p, flat(90, 1.4));
  near(Math.max(...s.days), 100 / 90 + 0.4);
  const e = smartSettle(p, s.left);
  near(total(p, flat(90, 1.4)) + e.user, 156.9, 0.05);
  near(e.us - 2, 20.9, 0.05);
});

test('a weak market is topped up from the reserve, never beyond it', () => {
  const p = smartPlan(100, 90);
  const s = smartSeries(p, flat(90, 0.6));
  assert.ok(s.left >= 0 && s.left < 1e-9);
  near(total(p, flat(90, 0.6)), 78.2, 0.05);
});

test('a rally first fills the reserve that covers the crash after it', () => {
  const p = smartPlan(100, 120);
  const ratios = [...flat(60, 1.4), ...flat(60, 0.6)];
  near(total(p, ratios), 136, 0.05);
});

test('a miner bought before the reserve existed pays as before', () => {
  const old = { budget: 100, days: 90, baseYield: 1.06 / 90 };
  const s = smartSeries(old, flat(90, 1));
  near(s.days.reduce((a, b) => a + b, 0), 106);
  assert.deepEqual(smartSettle(old, 0), { user: 0, us: 0 });
});
