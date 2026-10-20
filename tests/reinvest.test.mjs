import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bestPlan,
  nextPlan,
  reinvestPick,
  smartPick,
  bundleFor,
  posFromTh,
  reinvestTitle,
  reinvestHref,
  SLIDER_SIZES,
  BUNDLE_MIN_USD,
} from '../lib/reinvest.js';
import { plans as CATALOGUE, customPlan, thFromPos } from '../lib/data.js';

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

// ---- Smart bundle (real catalogue: Starter $27, Basic $215, nothing in between) ----

test('bundle: the demo balance of about $90 gets a custom bundle, not the $27 Starter', () => {
  const s = smartPick(CATALOGUE, 90);
  assert.equal(s.custom, true);
  assert.equal(s.plan.id, 'custom');
  assert.equal(s.plan.th, 24);
  assert.equal(s.plan.days, 180);
  assert.ok(s.plan.price <= 90 && s.plan.price > 80);
  assert.equal(s.left, Math.round((90 - s.plan.price) * 100) / 100);
  assert.equal(s.next.id, 'basic');
  assert.equal(s.short, 215 - 90);
});

test('bundle: a catalogue plan that uses most of the balance is kept', () => {
  for (const [bal, id] of [[27, 'starter'], [30, 'starter'], [215, 'basic'], [260, 'basic'], [400, 'growth'], [2000, 'plus']]) {
    const s = smartPick(CATALOGUE, bal);
    assert.equal(s.custom, false, `balance ${bal}`);
    assert.equal(s.plan.id, id, `balance ${bal}`);
  }
});

test('bundle: grows with the balance and fills the gaps between plans', () => {
  let last = 0;
  for (const bal of [50, 90, 150, 200, 300]) {
    const s = smartPick(CATALOGUE, bal);
    assert.equal(s.custom, true, `balance ${bal}`);
    assert.ok(s.plan.th > last, `balance ${bal} should buy more than the one before`);
    assert.ok(s.plan.price <= bal, `balance ${bal}`);
    last = s.plan.th;
  }
});

test('bundle: below the minimum there is no suggestion, and a bad term is refused', () => {
  assert.equal(smartPick(CATALOGUE, 5), null);
  assert.equal(smartPick(CATALOGUE, 0), null);
  assert.equal(smartPick(CATALOGUE, 9.99), null);
  assert.equal(bundleFor(90, 45), null);
  assert.equal(bundleFor(NaN), null);
  assert.ok(bundleFor(BUNDLE_MIN_USD + 1));
});

test('bundle: never costs more than the balance, over a sweep of balances and terms', () => {
  for (let bal = 10; bal <= 20000; bal = bal < 1000 ? bal + 7.3 : bal + 311.7) {
    for (const term of [90, 180, 365]) {
      const b = bundleFor(bal, term);
      if (b) assert.ok(b.price <= bal, `balance ${bal} term ${term}`);
    }
  }
});

test('bundle: slider sizes are all reachable and posFromTh round-trips', () => {
  for (const th of SLIDER_SIZES) {
    const pos = posFromTh(th);
    assert.equal(thFromPos(pos), th, `size ${th} at position ${pos}`);
  }
  assert.equal(customPlan(24, 180).th, 24);
});

test('bundle: title and link point at the custom sheet with size and term', () => {
  const s = smartPick(CATALOGUE, 90);
  assert.match(reinvestTitle(s), /24 TH\/s bundle/);
  assert.equal(reinvestHref(s), '/plans?plan=custom&th=24&days=180');
  const p = smartPick(CATALOGUE, 215);
  assert.equal(reinvestHref(p), '/plans?plan=basic');
  assert.match(reinvestTitle(p), /Basic/);
});
