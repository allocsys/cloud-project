import test from 'node:test';
import assert from 'node:assert/strict';
import { ASIC_TIERS, SMART_TIERS, tierOf, budgetFromPos, posFromBudget } from '../lib/tiers.js';
import { SMART } from '../lib/smart.js';

test('ASICs tiers change at the rig boundaries', () => {
  assert.equal(tierOf(ASIC_TIERS, 1).id, 'starter');
  assert.equal(tierOf(ASIC_TIERS, 29.5).id, 'starter');
  assert.equal(tierOf(ASIC_TIERS, 30).id, 'basic');
  assert.equal(tierOf(ASIC_TIERS, 99).id, 'basic');
  assert.equal(tierOf(ASIC_TIERS, 100).id, 'growth');
  assert.equal(tierOf(ASIC_TIERS, 250).id, 'plus');
  assert.equal(tierOf(ASIC_TIERS, 499).id, 'plus');
  assert.equal(tierOf(ASIC_TIERS, 500).id, 'pro');
  assert.equal(tierOf(ASIC_TIERS, 1000).id, 'elite');
});

test('Smart Mining tiers', () => {
  assert.equal(tierOf(SMART_TIERS, SMART.min).id, 'spark');
  assert.equal(tierOf(SMART_TIERS, 499).id, 'spark');
  assert.equal(tierOf(SMART_TIERS, 500).id, 'flow');
  assert.equal(tierOf(SMART_TIERS, 2000).id, 'surge');
  assert.equal(tierOf(SMART_TIERS, SMART.max).id, 'nova');
});

test('budget slider ends on the limits and snaps to $50', () => {
  assert.equal(budgetFromPos(0), SMART.min);
  assert.equal(budgetFromPos(1000), SMART.max);
  assert.equal(budgetFromPos(-5), SMART.min);
  assert.equal(budgetFromPos(5000), SMART.max);
  let last = 0;
  for (let p = 0; p <= 1000; p += 1) {
    const b = budgetFromPos(p);
    assert.equal(b % 50, 0);
    assert.ok(b >= last, `not decreasing at ${p}`);
    assert.ok(b >= SMART.min && b <= SMART.max);
    last = b;
  }
});

test('a budget goes to the slider and back to the same budget', () => {
  for (let b = SMART.min; b <= SMART.max; b += 50) assert.equal(budgetFromPos(posFromBudget(b)), b, `budget ${b}`);
});

test('Smart Mining tiers are spread along the track', () => {
  const at = SMART_TIERS.map((t) => posFromBudget(t.from));
  assert.equal(at[0], 0);
  for (let i = 1; i < at.length; i += 1) assert.ok(at[i] - at[i - 1] >= 150, `tier ${i} too close: ${at}`);
});
