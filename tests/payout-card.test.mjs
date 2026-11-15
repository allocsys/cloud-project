import { test } from 'node:test';
import assert from 'node:assert/strict';
import { payoutCard } from '../lib/payout-card.js';

const DAY = 86400000;
const NOW = 20_000 * DAY + 5 * 3600_000; // 05:00 UTC on UTC day 20000
const rows = (y, today = 0.4) => [{ usd: 1 }, { usd: y }, { usd: today }];

test('shows yesterday\'s payout once a day', () => {
  assert.deepEqual(payoutCard(rows(2.5), NOW, 19_999), { day: 20_000, usd: 2.5 });
  assert.deepEqual(payoutCard(rows(2.5), NOW, 0), { day: 20_000, usd: 2.5 });
});

test('stays hidden once closed today, or while the stored day is unknown', () => {
  assert.equal(payoutCard(rows(2.5), NOW, 20_000), null);
  assert.equal(payoutCard(rows(2.5), NOW, null), null);
  assert.equal(payoutCard(rows(2.5), NOW, undefined), null);
});

test('stays hidden when yesterday paid nothing or there is no history', () => {
  assert.equal(payoutCard(rows(0), NOW, 0), null);
  assert.equal(payoutCard([{ usd: 3 }], NOW, 0), null);
  assert.equal(payoutCard([], NOW, 0), null);
  assert.equal(payoutCard(undefined, NOW, 0), null);
  assert.equal(payoutCard(rows(2.5), NaN, 0), null);
});
