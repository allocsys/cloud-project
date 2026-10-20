import test from 'node:test';
import assert from 'node:assert/strict';
import { bestPlan, nextPlan, reinvestPick } from '../lib/reinvest.js';

const plans = [
  { id: 'starter', th: 15, price: 27 },
  { id: 'basic', th: 60, price: 215 },
  { id: 'growth', th: 100, price: 335 },
  { id: 'plus', th: 250, price: 1699 },
];

test('best plan is the most expensive one the balance covers', () => {
  assert.equal(bestPlan(plans, 26.99), null);
  assert.equal(bestPlan(plans, 27).id, 'starter');
  assert.equal(bestPlan(plans, 300).id, 'basic');
  assert.equal(bestPlan(plans, 335).id, 'growth');
  assert.equal(bestPlan(plans, 99999).id, 'plus');
});

test('best plan does not depend on catalogue order and ignores empty input', () => {
  assert.equal(bestPlan([...plans].reverse(), 400).id, 'growth');
  assert.equal(bestPlan([], 100), null);
  assert.equal(bestPlan(undefined, 100), null);
});

test('next plan is the cheapest one still out of reach', () => {
  assert.equal(nextPlan(plans, 300).id, 'growth');
  assert.equal(nextPlan(plans, 99999), null);
});

test('reinvest pick: plan, what is left, how many fit, how far the next one is', () => {
  assert.equal(reinvestPick(plans, 10), null);
  const r = reinvestPick(plans, 300);
  assert.equal(r.plan.id, 'basic');
  assert.equal(r.left, 85);
  assert.equal(r.count, 2);
  assert.equal(r.next.id, 'growth');
  assert.equal(r.short, 35);
  const top = reinvestPick(plans, 5000);
  assert.equal(top.plan.id, 'plus');
  assert.equal(top.next, null);
  assert.equal(top.short, 0);
});
