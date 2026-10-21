import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEarnings } from '@/lib/earnings';
import { smartPlan } from '@/lib/smart';

const DAY = 86400000;
const now = Date.UTC(2026, 9, 21, 12, 0, 0);
const today = Math.floor(now / DAY) * DAY;
const start = today - 100 * DAY; // the 90 day term is over

function miner(plan) {
  return { serial: 'S9', smart: true, th: 0, hall: 'smart', online: true, dailyUsd: 1, startedAt: start, budget: plan.budget, days: plan.days, baseYield: plan.baseYield, reserve: plan.reserve };
}
// Every day of the term at one ratio of the BTC reference.
function marketAt(ratio) {
  const picks = {};
  const days = {};
  for (let i = 0; i <= 100; i += 1) {
    const d = start + i * DAY;
    picks[d] = 'BTC';
    days[d] = { BTC: ratio };
  }
  return { days: {}, live: null, halls: {}, smart: { refs: { BTC: 1 }, picks, days, prev: 'BTC', live: null } };
}
const totalAt = (plan, ratio) => buildEarnings([miner(plan)], now, 100000, marketAt(ratio)).totalUsd;
const near = (a, b, e = 0.05) => assert.ok(Math.abs(a - b) <= e, `${a} vs ${b}`);

test('a finished term in a flat market pays budget x (1 + 0.3% x days)', () => {
  near(totalAt(smartPlan(100, 90), 1), 127);
});

test('a finished term in a strong market pays the capped days plus half of the reserve left', () => {
  near(totalAt(smartPlan(100, 90), 1.4), 156.9);
});

test('a finished term in a weak market is topped up only from the seed', () => {
  near(totalAt(smartPlan(100, 90), 0.6), 78.2);
});

test('a miner bought before the reserve existed is paid as before', () => {
  const plan = smartPlan(100, 90);
  const old = { ...miner(plan), baseYield: 1.06 / 90 };
  delete old.reserve;
  near(buildEarnings([old], now, 100000, marketAt(1)).totalUsd, 106);
});
