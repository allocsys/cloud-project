// The deposit hold (lib/deposit-hold.js): without a plan every deposit unlocks 14 days after its own date, a plan lifts the hold,
// and a refunded plan does not count. Pure rules, no database.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { hasPlan, lotsOf, addLot, lockedBtc } = await import('@/lib/deposit-hold');

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 26);
const user = (extra = {}) => ({ history: [], ...extra });

test('each deposit unlocks on its own day: the older one is free while the newer one stays locked', () => {
  const u = user();
  addLot(u, 0.3, NOW - 14 * DAY - 1000);
  addLot(u, 1, NOW - 7 * DAY);
  assert.equal(lockedBtc(u, NOW), 1);
  assert.equal(lockedBtc(u, NOW + 7 * DAY - 1), 1);
  assert.equal(lockedBtc(u, NOW + 7 * DAY), 0);
});

test('the day before the 14th is still locked, and addLot drops lots that are already free', () => {
  const u = user();
  addLot(u, 0.5, NOW - 14 * DAY + 1000);
  assert.equal(lockedBtc(u, NOW), 0.5);
  addLot(u, 0.2, NOW + 15 * DAY);
  assert.deepEqual(u.lots.map((l) => l.btc), [0.2]);
});

test('a plan lifts the hold, a refunded plan does not', () => {
  const u = user({ history: [{ kind: 'purchase', net: 'Balance', at: NOW }] });
  addLot(u, 1, NOW);
  assert.equal(hasPlan(u), true);
  assert.equal(lockedBtc(u, NOW), 0);
  u.history[0].refunded = true;
  assert.equal(hasPlan(u), false);
  assert.equal(lockedBtc(u, NOW), 1);
  u.history.unshift({ kind: 'purchase', net: 'Crypto', at: NOW + 1 });
  assert.equal(lockedBtc(u, NOW), 0, 'a second, paid plan counts again');
});

test('an account from before lots were saved is read from its deposit rows, and new deposits keep them', () => {
  const u = user({ history: [{ kind: 'deposit', at: NOW - 3 * DAY, amount: '+0.40000000' }, { kind: 'deposit', at: NOW - 30 * DAY, amount: '+0.90000000' }] });
  assert.equal(lockedBtc(u, NOW), 0.4);
  assert.equal(lotsOf(u, NOW).length, 1);
  addLot(u, 0.1, NOW);
  assert.ok(Math.abs(lockedBtc(u, NOW) - 0.5) < 1e-12);
});

test('no deposits means nothing is locked', () => {
  assert.equal(lockedBtc(user(), NOW), 0);
});
