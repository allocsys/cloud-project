// A Smart Mining miner with a reserve: the earnings screens must show exactly what the day-by-day reserve series pays
// (lib/smart.js smartSeries), for a finished term, one still running, and one with a day paused by the profit guard.
// Guards the once-per-call series in lib/earnings.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { buildEarnings, minerDaily, payoutDays } = await import('@/lib/earnings');
const { smartPlan, smartSeries, smartSettle, SMART_FLAT_FROM } = await import('@/lib/smart');
const { termEnd, isPaused, scopeOf } = await import('@/lib/guard');

const DAY = 86400000;
const utcDay = (t) => Math.floor(t / DAY) * DAY;
const BTC = 50000;

function miner(budget, days, startedAt) {
  return { ...smartPlan(budget, days), serial: `t${budget}${days}`, startedAt, online: true };
}

// One UTC day of `day` switched off by hand for every Smart miner (an 'extend' miner's term moves back a day).
const pausedOn = (day) => ({ manual: { smart: [{ from: day, state: 'paused' }, { from: day + DAY, state: 'auto' }] }, paused: {} });

// What the series pays, day by day, with every ratio 1 (no coin market), summed up to `now`.
function expected(c, now, guard = null) {
  const start = c.startedAt;
  const end = termEnd(c, start, guard);
  const scope = scopeOf(c);
  const first = utcDay(start);
  const lastIdx = Math.floor((end - 1 - first) / DAY);
  const ratios = [];
  const weights = [];
  const off = [];
  const flat = [];
  for (let i = 0; i <= lastIdx; i += 1) {
    const d = first + i * DAY;
    ratios.push(1);
    weights.push(Math.max(0, Math.min(d + DAY, end) - Math.max(d, start)) / DAY);
    off.push(isPaused(guard, scope, d));
    flat.push(d >= SMART_FLAT_FROM);
  }
  const s = smartSeries(c, ratios, weights, off, flat);
  const perDay = (i) => s.days[i] + (i === lastIdx && now >= end ? smartSettle(c, s.left).user : 0);
  let total = 0;
  const today = utcDay(now);
  for (let day = first; day <= today; day += DAY) {
    const i = Math.round((day - first) / DAY);
    if (i > lastIdx) break;
    if (isPaused(guard, scope, day)) continue;
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

test('a day paused by the profit guard pays nothing and the numbers still match, running and finished', () => {
  const start = Date.UTC(2026, 9, 28, 7, 30, 0);
  const guard = pausedOn(utcDay(start) + 10 * DAY);
  const market = { guard, days: {}, halls: {} };
  const c = miner(300, 90, start);
  for (const now of [start + 40 * DAY + 3600000, start + 200 * DAY]) {
    const e = buildEarnings([c], now, BTC, market);
    assert.ok(Math.abs(e.totalUsd - expected(c, now, guard)) < 1e-6, `${e.totalUsd} vs ${expected(c, now, guard)}`);
  }
  const rows = minerDaily(c, start + 40 * DAY + 3600000, market, BTC).rows;
  const stopped = rows.filter((r) => r.paused);
  assert.equal(stopped.length, 1);
  assert.equal(stopped[0].usd, 0);
});

test('two miners add up, and the daily list and the payout list agree', () => {
  const start = Date.UTC(2026, 9, 28, 7, 30, 0);
  const now = start + 30 * DAY + 3600000;
  const a = miner(100, 90, start);
  const b = miner(300, 150, start + 5 * DAY);
  const e = buildEarnings([a, b], now, BTC, null);
  assert.ok(Math.abs(e.totalUsd - (expected(a, now) + expected(b, now))) < 1e-6);
  const listed = minerDaily(a, now, null, BTC).usd + minerDaily(b, now, null, BTC).usd;
  const paid = payoutDays([a, b], now, BTC, 400, null).reduce((s, p) => s + p.btc * BTC, 0);
  assert.ok(Math.abs(listed - paid) < 1e-6, 'finished days agree between the two lists');
});
