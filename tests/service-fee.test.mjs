import test from 'node:test';
import assert from 'node:assert/strict';
import { serviceTier, serviceLine } from '../lib/service-fee.js';

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;
const at = (days) => serviceTier(NOW - days * DAY, NOW);

test('tiers: 2% under 7 days, 1% from 7 to 30, 0% from 31', () => {
  assert.equal(at(0).pct, 2);
  assert.equal(at(6.9).pct, 2);
  assert.equal(at(7).pct, 1);
  assert.equal(at(30.9).pct, 1);
  assert.equal(at(31).pct, 0);
  assert.equal(at(400).pct, 0);
});

test('no date counts as the top tier; a date in the future is day 0', () => {
  assert.equal(serviceTier(null, NOW).pct, 2);
  assert.equal(serviceTier(NOW + DAY, NOW).pct, 2);
});

test('countdown: whole days left, at least 1', () => {
  assert.equal(at(4).daysLeft, 3);
  assert.equal(at(6.5).daysLeft, 1);
  assert.equal(at(19).daysLeft, 12);
  assert.equal(at(31).daysLeft, 0);
});

test('countdown lines', () => {
  assert.equal(serviceLine(at(4)), 'Service fee 2%. Drops to 1% in 3 days.');
  assert.equal(serviceLine(at(6.5)), 'Service fee 2%. Drops to 1% in 1 day.');
  assert.equal(serviceLine(at(19)), 'Service fee 1%. Free in 12 days.');
  assert.equal(serviceLine(at(40)), 'No service fee. Withdraw free.');
});
