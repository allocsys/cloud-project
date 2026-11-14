import test from 'node:test';
import assert from 'node:assert/strict';
import { serviceTier, serviceLine, serviceProgress } from '../lib/service-fee.js';

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;
const at = (days) => serviceTier(NOW - days * DAY, NOW);

test('tiers: 3% under 7 days, 2.5% from 7 to 30, 2% from 31 to 45, 0% from 46', () => {
  assert.equal(at(0).pct, 3);
  assert.equal(at(6.9).pct, 3);
  assert.equal(at(7).pct, 2.5);
  assert.equal(at(30.9).pct, 2.5);
  assert.equal(at(31).pct, 2);
  assert.equal(at(45.9).pct, 2);
  assert.equal(at(46).pct, 0);
  assert.equal(at(400).pct, 0);
});

test('no date counts as the top tier; a date in the future is day 0', () => {
  assert.equal(serviceTier(null, NOW).pct, 3);
  assert.equal(serviceTier(NOW + DAY, NOW).pct, 3);
});

test('countdown: whole days left, at least 1', () => {
  assert.equal(at(4).daysLeft, 3);
  assert.equal(at(6.5).daysLeft, 1);
  assert.equal(at(19).daysLeft, 12);
  assert.equal(at(40).daysLeft, 6);
  assert.equal(at(46).daysLeft, 0);
});

test('countdown lines', () => {
  assert.equal(serviceLine(at(4)), 'Service fee 3%. Drops to 2.5% in 3 days.');
  assert.equal(serviceLine(at(6.5)), 'Service fee 3%. Drops to 2.5% in 1 day.');
  assert.equal(serviceLine(at(19)), 'Service fee 2.5%. Drops to 2% in 12 days.');
  assert.equal(serviceLine(at(40)), 'Service fee 2%. Free in 6 days.');
  assert.equal(serviceLine(at(60)), 'No service fee. Withdraw free.');
});

test('progress to the fee-free tier: percent and whole days left', () => {
  const p = (d) => serviceProgress(NOW - d * DAY, NOW);
  assert.deepEqual(p(0), { pct: 0, daysToFree: 46 });
  assert.equal(p(23).pct, 50);
  assert.equal(p(45.9).daysToFree, 1);
  assert.deepEqual(p(46), { pct: 100, daysToFree: 0 });
  assert.deepEqual(p(400), { pct: 100, daysToFree: 0 });
  assert.deepEqual(serviceProgress(null, NOW), { pct: 0, daysToFree: 46 });
});
