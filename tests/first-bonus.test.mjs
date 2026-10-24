// First-buy bonus maths (lib/first-bonus.js): the settings, who is a first buyer, and what ASICs and Smart Mining buys get.
import test from 'node:test';
import assert from 'node:assert/strict';
import { customPlan } from '@/lib/data';
import { smartPlan, SMART } from '@/lib/smart';
import { contractPayout } from '@/lib/guard';
import { FIRST_BONUS, normalizeFirstBonus, firstBonusOn, isFirstBuy, applyFirstBonus, bonusText } from '@/lib/first-bonus';

const cfg = { enabled: true, pct: 10, capTh: 5, capUsd: 50, minUsd: 0, until: null };

test('settings: off by default, and anything invalid falls back to the defaults', () => {
  assert.deepEqual(normalizeFirstBonus(undefined), FIRST_BONUS);
  assert.equal(normalizeFirstBonus(undefined).enabled, false);
  const n = normalizeFirstBonus({ enabled: true, pct: 500, capTh: 'x', capUsd: -1, minUsd: '', until: 'soon' });
  assert.deepEqual(n, { ...FIRST_BONUS, enabled: true });
  assert.equal(normalizeFirstBonus({ pct: 25 }).pct, 25);
  assert.equal(normalizeFirstBonus({ enabled: 'true' }).enabled, false, 'only a real true turns it on');
});

test('on means enabled and before the end date', () => {
  const now = Date.UTC(2026, 9, 24);
  assert.equal(firstBonusOn(cfg, now), true);
  assert.equal(firstBonusOn({ ...cfg, enabled: false }, now), false);
  assert.equal(firstBonusOn({ ...cfg, until: now + 1000 }, now), true);
  assert.equal(firstBonusOn({ ...cfg, until: now - 1000 }, now), false);
  assert.equal(firstBonusOn(undefined, now), false);
});

test('a first buyer has never paid for a miner', () => {
  assert.equal(isFirstBuy({ contracts: [], history: [] }), true);
  assert.equal(isFirstBuy({ firstBuy: 1, contracts: [], history: [] }), false);
  assert.equal(isFirstBuy({ contracts: [{ price: 20 }], history: [] }), false, 'a miner bought or granted');
  assert.equal(isFirstBuy({ contracts: [{ bonus: true, price: 20 }], history: [] }), true, 'a gift miner does not count');
  assert.equal(isFirstBuy({ contracts: [], history: [{ kind: 'purchase', net: 'Crypto' }] }), false);
  assert.equal(isFirstBuy({ contracts: [], history: [{ kind: 'purchase', net: 'Balance' }] }), false);
  assert.equal(isFirstBuy({ contracts: [], history: [{ kind: 'purchase' }] }), true, 'an admin grant has no payment method');
  assert.equal(isFirstBuy(null), false);
});

test('ASICs: the percent of the size in extra TH/s, price unchanged, daily payout in step', () => {
  const plan = customPlan(15, 90);
  const r = applyFirstBonus(cfg, plan);
  assert.deepEqual(r.bonus, { pct: 10, th: 1.5 });
  assert.equal(r.plan.th, 16.5);
  assert.equal(r.plan.price, plan.price);
  assert.equal(r.plan.days, 90);
  assert.equal(r.plan.hall, plan.hall, 'the hall is the one that was bought');
  assert.ok(Math.abs(parseFloat(r.plan.daily.slice(1)) - parseFloat(plan.daily.slice(1)) * 1.1) < 0.011);
  assert.equal(plan.th, 15, 'the plan passed in is not changed');
  assert.equal(bonusText(r.bonus), '1.5 TH/s');
});

test('ASICs: the TH/s cap, the minimum purchase, and a bonus too small to count', () => {
  const big = customPlan(100, 90);
  const r = applyFirstBonus(cfg, big);
  assert.deepEqual(r.bonus, { pct: 5, th: 5 });
  assert.equal(r.plan.th, 105);
  assert.equal(applyFirstBonus({ ...cfg, minUsd: big.price + 1 }, big), null);
  assert.ok(applyFirstBonus({ ...cfg, minUsd: big.price }, big), 'the minimum itself qualifies');
  assert.equal(applyFirstBonus({ ...cfg, pct: 0.1 }, customPlan(1, 90)), null, 'under 0.01 TH/s');
  assert.equal(applyFirstBonus({ ...cfg, enabled: false }, big), null);
  assert.equal(applyFirstBonus(cfg, null), null);
});

test('Smart Mining: the profit rate goes up by the percent, the budget and price stay', () => {
  const plan = smartPlan(500, 120);
  const r = applyFirstBonus(cfg, plan);
  const p0 = contractPayout(plan);
  const p1 = contractPayout(r.plan);
  assert.ok(Math.abs(p1 / p0 - 1.1) < 0.005, `about +10%, got ${p1 / p0}`);
  assert.ok(r.bonus.pct > 9.5 && r.bonus.pct < 10.5);
  assert.ok(Math.abs(r.bonus.usd - 500 * (p1 / p0 - 1)) < 0.5);
  assert.equal(r.plan.budget, 500);
  assert.equal(r.plan.price, 500);
  assert.equal(r.plan.days, 120);
  assert.ok(r.plan.baseYield > plan.baseYield);
  assert.ok(r.plan.reserve.hi > plan.reserve.hi && r.plan.reserve.lo > plan.reserve.lo);
  assert.ok(Math.abs(p1 * 1e5 - Math.round(p1 * 1e5)) < 1e-6, 'still a multiple of 0.001% a day, which the profit guard relies on');
  assert.equal(bonusText(r.bonus), `${r.bonus.pct}%`);
});

test('Smart Mining: the USD cap is measured on the budget, and the rate never passes the limit', () => {
  const plan = smartPlan(500, 120);
  const capped = applyFirstBonus({ ...cfg, capUsd: 25 }, plan);
  assert.ok(capped.bonus.pct > 4.5 && capped.bonus.pct < 5.5, `about 5%, got ${capped.bonus.pct}`);
  assert.ok(capped.bonus.usd <= 26);
  const huge = applyFirstBonus({ ...cfg, pct: 100, capUsd: 10000 }, smartPlan(10000, 150));
  assert.ok(contractPayout(huge.plan) <= SMART.payoutMax + 1e-9);
  assert.equal(applyFirstBonus({ ...cfg, minUsd: 501 }, plan), null);
});
