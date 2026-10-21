import test from 'node:test';
import assert from 'node:assert/strict';
import { payoutDays, buildEarnings } from '@/lib/earnings';

const DAY = 86400000;
const now = Date.UTC(2026, 9, 21, 12, 0, 0);
const today = Math.floor(now / DAY) * DAY;
const d = (k) => today - k * DAY;
const BTC = 100000;
const smartMiner = { serial: 'S1', smart: true, budget: 1000, baseYield: 0.01, th: 0, hall: 'x', days: 30, startedAt: d(3), online: true, dailyUsd: 10 };
const usdOf = (rows) => rows.map((r) => Math.round(r.btc * BTC * 100) / 100);

test('a Smart Mining contract pays budget x base yield x the day coin ratio, newest day first', () => {
  const market = {
    days: {},
    live: null,
    halls: {},
    smart: {
      refs: { BTC: 1, KAS: 1 },
      picks: { [d(3)]: 'KAS', [d(2)]: 'BTC' },
      days: { [d(3)]: { KAS: 1.5, BTC: 1 }, [d(2)]: { BTC: 0.8 } },
      prev: 'BTC',
      live: null,
    },
  };
  // d(3): KAS at 1.5 -> $15. d(2): BTC at 0.8 -> $8. d(1) has no pick or figure: carries d(2)'s 0.8 -> $8.
  assert.deepEqual(usdOf(payoutDays([smartMiner], now, BTC, 30, market)), [8, 8, 15]);
});

test('with no Smart Mining data a day pays at the reference: budget x base yield', () => {
  assert.deepEqual(usdOf(payoutDays([smartMiner], now, BTC, 30, null)), [10, 10, 10]);
  const market = { days: {}, live: null, halls: {}, smart: null };
  assert.deepEqual(usdOf(payoutDays([smartMiner], now, BTC, 30, market)), [10, 10, 10]);
});

test("today follows the live market's best coin and holds the previous coin inside the hysteresis", () => {
  const smart = (live) => ({ refs: { BTC: 1, KAS: 1 }, picks: {}, days: {}, prev: 'BTC', live });
  const todayUsd = (live) => buildEarnings([smartMiner], now, BTC, { days: {}, live: null, halls: {}, smart: smart(live) }).todayBtc * BTC;
  assert.ok(Math.abs(todayUsd({ BTC: 1, KAS: 1.5 }) - 15) < 1e-6); // KAS far ahead
  assert.ok(Math.abs(todayUsd({ BTC: 1, KAS: 1.02 }) - 10) < 1e-6); // inside 3%: BTC stays, ratio 1
});
