import test from 'node:test';
import assert from 'node:assert/strict';
import { usdPerDay, withLiveDaily } from '../lib/earnings.js';
import { smartBaseYield, SMART_LOSS_FROM, lostDay } from '../lib/smart.js';

const D = 86400000;
const utcDay = (t) => Math.floor(t / D) * D;
// A $1000, 90 day plan at 0.3% a day. Principal share 1000 / 90 a day, profit 3 a day at ratio 1.
const c = { smart: true, hall: 'smart', budget: 1000, days: 90, baseYield: smartBaseYield(90, 0.003), startedAt: Date.UTC(2026, 9, 1) };
const share = 1000 / 90;
const market = (smart) => ({ smart: { refs: { BTC: 2 }, picks: {}, days: {}, live: null, prev: 'BTC', ...smart }, halls: {} });

test('lostDay: figures and every coin at 0 or below; no figures is not a loss', () => {
  assert.equal(lostDay({ BTC: -1, KAS: 0 }), true);
  assert.equal(lostDay({ BTC: -1, KAS: 0.1 }), false);
  assert.equal(lostDay({}), false);
  assert.equal(lostDay(null), false);
});

test('a finished day on which every coin loses money pays the principal share only', () => {
  const good = Date.UTC(2026, 10, 21);
  const bad = Date.UTC(2026, 10, 22);
  const m = market({ picks: { [good]: 'BTC', [bad]: 'BTC' }, days: { [good]: { BTC: 4 }, [bad]: { BTC: -1 } } });
  const now = Date.UTC(2026, 10, 25, 12);
  assert.ok(usdPerDay(c, good, m, now) > share + 1);
  assert.ok(Math.abs(usdPerDay(c, bad, m, now) - share) < 1e-9);
});

test('a loss day before 21 Nov 2026 keeps what it was paid (carried ratio)', () => {
  const good = SMART_LOSS_FROM - 2 * D;
  const bad = SMART_LOSS_FROM - D;
  const m = market({ picks: { [good]: 'BTC', [bad]: 'BTC' }, days: { [good]: { BTC: 4 }, [bad]: { BTC: -1 } } });
  assert.ok(usdPerDay(c, bad, m, SMART_LOSS_FROM + 3 * D) > share + 1);
});

test('a day with no market figures at all still carries the last known ratio', () => {
  const good = Date.UTC(2026, 10, 21);
  const none = Date.UTC(2026, 10, 22);
  const m = market({ picks: { [good]: 'BTC' }, days: { [good]: { BTC: 4 } } });
  assert.ok(usdPerDay(c, none, m, Date.UTC(2026, 10, 25, 12)) > share + 1);
});

test("today's figure is the principal share when every coin loses money now", () => {
  const today = utcDay(Date.now());
  const y = today - D;
  const m = { live: { gross: 1 }, ...market({ picks: { [y]: 'BTC' }, days: { [y]: { BTC: 4 } }, live: { BTC: -1 } }) };
  const [out] = withLiveDaily([c], m);
  assert.equal(out.dailyUsd, Math.round(share * 100) / 100);
});

test("today's figure follows the live market when a coin earns", () => {
  const today = utcDay(Date.now());
  const y = today - D;
  const m = { live: { gross: 1 }, ...market({ picks: { [y]: 'BTC' }, days: { [y]: { BTC: 4 } }, live: { BTC: 4 } }) };
  const [out] = withLiveDaily([c], m);
  assert.ok(out.dailyUsd > share + 1);
});
