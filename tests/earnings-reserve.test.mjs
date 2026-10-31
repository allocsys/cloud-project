// A Smart Mining miner with a reserve: the earnings screens must show exactly what the day-by-day reserve series pays
// (lib/smart.js smartSeries), for a finished term and one still running. Guards the once-per-call series in lib/earnings.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { buildEarnings, minerDaily, payoutDays } = await import('@/lib/earnings');
const { smartPlan, smartSeries, smartSettle, SMART_FLAT_FROM } = await import('@/lib/smart');

const DAY = 86400000;
const utcDay = (t) => Math.floor(t / DAY) * DAY;
const BTC = 50000;

function miner(budget, days, startedAt) {
  return { ...smartPlan(budget, days), serial: `t${budget}${days}`, startedAt, online: true };
}

// What the series pays, day by day, with every ratio 1 (no market), summed up to `now`.
function expected(c, now) {
  const start = c.startedAt;
  const end = start + c.days * DAY;
  const first = utcDay(start);
  const lastIdx = Math.floor((end - 1 - first) / DAY);
  const ratios = [];
  const weights = [];
  const flat = [];
  for (let i = 0; i <= lastIdx; i += 1) {
    const d = first + i * DAY;
    ratios.push(1);
    weights.push(Math.max(0, Math.min(d + DAY, end) - Math.max(d, start)) / DAY);
    flat.push(d >= SMART_FLAT_FROM);
  }
  const s = smartSeries(c, ratios, weights, null, flat);
  const perDay = (i) => s.days[i] + (i === lastIdx && now >= end ? smartSettle(c, s.left).user : 0);
  let total = 0;
  const today = utcDay(now);
  for (let day = first; day <= today; day += DAY) {
    const i = Math.round((day - first) / DAY);
    if (i > lastIdx) break;
    const a = Math.max(day, start);
    const b = Math.min(day + DAY, end, now);
    if (b <= a) continue;
    const full = Math.min(day + DAY, end) - Math.max(day, start);
    total += (perDay(i) * (b - a)) / full;
  }
  return total;
}

test('a finished Smart miner with a reserve earns exactly what its series pays', () => {
  const now = Date.UTC(2026, 10, 20, 15, 0, 0);
  const c = miner(500, 90, Date.UTC(2026, 9, 28, 7, 30, 0) - 120 * DAY);
  assert.ok(now > c.startedAt + c.days * DAY, 'the term is over');
  const e = buildEarnings([c], now, BTC, null);
  assert.ok(Math.abs(e.totalUsd - expected(c, now)) < 1e-6, `${e.totalUsd} vs ${expected(c, now)}`);
});

test('a Smart miner part way through its term earns exactly what its series pays', () => {
  const start = Date.UTC(2026, 9, 28, 7, 30, 0);
  const now = start + 40 * DAY + 7 * 3600000;
  const c = miner(200, 120, start);
  const e = buildEarnings([c], now, BTC, null);
  assert.ok(Math.abs(e.totalUsd - expected(c, now)) < 1e-6, `${e.totalUsd} vs ${expected(c, now)}`);
});

test('two miners add up, and the chart and the daily list agree with the total', () => {
  const start = Date.UTC(2026, 9, 28, 7, 30, 0);
  const now = start + 30 * DAY + 3600000;
  const a = miner(100, 90, start);
  const b = miner(300, 150, start + 5 * DAY);
  const e = buildEarnings([a, b], now, BTC, null);
  assert.ok(Math.abs(e.totalUsd - (expected(a, now) + expected(b, now))) < 1e-6);
  const listed = minerDaily(a, now, null, BTC).usd + minerDaily(b, now, null, BTC).usd;
  const paid = payoutDays([a, b], now, BTC, 400, null).reduce((s, p) => s + p.btc * BTC, 0);
  assert.ok(Math.abs(listed - paid) < 1e-6, 'finished days agree between the two lists');
  assert.ok(Math.abs(e.totalUsd - listed - (expected(a, now) + expected(b, now) - listed)) < 1e-6);
});
