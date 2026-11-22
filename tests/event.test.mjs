// Deposit bonus event, the pure part: settings clean-up, when it is live, and how many tickets a deposit earns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEvent, eventLive, eventTickets, EVENT_MAX, EVENT_DEFAULTS } from '@/lib/event';
import { giftBoost, GIFT_TICKET, normalizeBoost } from '@/lib/boost';

test('settings fall back to the defaults and keep valid values', () => {
  assert.deepEqual(normalizeEvent(undefined), EVENT_DEFAULTS);
  const ev = normalizeEvent({ enabled: true, id: 'ab12', startAt: 1000, endsAt: 2000, perUsd: '25.5', ticket: 't100', maxPerUser: 4 });
  assert.deepEqual(ev, { enabled: true, id: 'ab12', startAt: 1000, endsAt: 2000, perUsd: 25.5, ticket: 't100', maxPerUser: 4 });
  const bad = normalizeEvent({ enabled: 'yes', perUsd: 0, ticket: 'nope', maxPerUser: -3 });
  assert.equal(bad.enabled, false);
  assert.equal(bad.perUsd, EVENT_DEFAULTS.perUsd);
  assert.equal(bad.ticket, EVENT_DEFAULTS.ticket);
  assert.equal(bad.maxPerUser, 0);
});

test('an order counts when it was started inside the event', () => {
  const ev = normalizeEvent({ enabled: true, startAt: 1000, endsAt: 2000 });
  assert.equal(eventLive(ev, 999), false);
  assert.equal(eventLive(ev, 1000), true);
  assert.equal(eventLive(ev, 2000), true);
  assert.equal(eventLive(ev, 2001), false);
  assert.equal(eventLive({ ...ev, enabled: false }, 1500), false);
});

test('tickets come in whole steps, with a cap per deposit and per user', () => {
  const ev = normalizeEvent({ enabled: true, perUsd: 50 });
  assert.equal(eventTickets(ev, 49.99), 0);
  assert.equal(eventTickets(ev, 50), 1);
  assert.equal(eventTickets(ev, 120), 2);
  assert.equal(eventTickets(ev, 1_000_000), EVENT_MAX.perDeposit);
  const lim = { ...ev, maxPerUser: 3 };
  assert.equal(eventTickets(lim, 500, 0), 3);
  assert.equal(eventTickets(lim, 500, 2), 1);
  assert.equal(eventTickets(lim, 500, 3), 0);
});

test('a bonus boost is a free boost of the chosen ticket', () => {
  const cfg = normalizeBoost({ enabled: true, chance: { t1: 5, t10: 6, t100: 7 } });
  const b = giftBoost({ id: 'x', cfg, rate: 100000, now: 5, roll: 999_999, ticket: 't10' });
  assert.equal(b.t, 't10');
  assert.equal(b.price, 10);
  assert.equal(b.gift, true);
  assert.equal(b.chance, 6);
  assert.equal(giftBoost({ id: 'y', cfg, rate: 100000, now: 5, roll: 0 }).t, GIFT_TICKET);
});
