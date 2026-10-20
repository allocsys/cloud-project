import test from 'node:test';
import assert from 'node:assert/strict';
import { halls } from '../lib/data.js';
import { btcPerThDay, grossPerThDay, netPerThDay, liveDaily, validDifficulty } from '../lib/market.js';
import { buildEarnings, payoutDays, minerDaily, withLiveDaily, usdPerDay } from '../lib/earnings.js';

const DAY = 86400000;
const D17 = Date.parse('2026-10-17T00:00:00Z');
const NOW = Date.parse('2026-10-20T12:00:00Z'); // half way through 20 Oct
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} is not within ${eps} of ${b}`);

// A 100 TH/s miner in the Iceland hall (15 J/TH, $0.05/kWh: electricity 0.018, maintenance 0.002 per TH/s per day).
const miner = { serial: 'OP-T', name: 'Growth 100 TH/s', th: 100, hall: 'is-2', days: 180, startedAt: D17, online: true, dailyUsd: 1.98 };
const market = {
  halls,
  days: {
    [D17]: { gross: 0.04, btc: 80000 },
    [D17 + DAY]: { gross: 0.03, btc: 90000 },
    [D17 + 2 * DAY]: { gross: 0.015, btc: 70000 }, // costs are above the hashprice this day
  },
  live: { gross: 0.0398, btc: 85000 },
};

test('hashprice from difficulty and price matches the late-2026 level', () => {
  const gross = grossPerThDay(1.327e14, 84800);
  assert.ok(gross > 0.039 && gross < 0.041, `gross ${gross}`);
  // Half the difficulty, twice the coins per TH/s.
  near(btcPerThDay(1e14) * 2, btcPerThDay(5e13));
});

test('difficulty readings outside a sane range are rejected', () => {
  assert.equal(validDifficulty(1.3e14), true);
  for (const bad of [0, -1, NaN, Infinity, 5, 1e20, null, undefined]) assert.equal(validDifficulty(bad), false);
});

test('net per TH/s is gross minus electricity and maintenance, never below zero', () => {
  near(netPerThDay(0.0398, halls['is-2']), 0.0198);
  assert.equal(netPerThDay(0.01, halls['is-2']), 0);
  assert.equal(netPerThDay(0.04, { name: 'No rates' }), null);
});

test('liveDaily is th x net, or null without a market', () => {
  near(liveDaily(100, halls['is-2'], { gross: 0.0398 }), 1.98);
  assert.equal(liveDaily(100, halls['is-2'], null), null);
});

test('every finished day is paid from its own snapshot, today from the live market', () => {
  const e = buildEarnings([miner], NOW, 84800, market);
  const usd = e.earnings.week.map((w) => w.usd);
  // 14, 15, 16 Oct: not started. 17: 100 x 0.02. 18: 100 x 0.01. 19: floored at 0. Today: half a day at the live rate.
  assert.deepEqual(usd, [0, 0, 0, 2, 1, 0, 0.99]);
  near(e.totalBtc, 2 / 80000 + 1 / 90000 + 0 + 0.99 / 85000, 1e-10);
  near(e.todayBtc, 0.99 / 85000, 1e-10);
});

test('a finished day does not move when the live market does', () => {
  const moved = { ...market, live: { gross: 0.09, btc: 20000 } };
  const a = buildEarnings([miner], NOW, 84800, market).earnings.week.slice(0, 6);
  const b = buildEarnings([miner], NOW, 84800, moved).earnings.week.slice(0, 6);
  assert.deepEqual(a, b);
  // The same days are paid out at the same BTC amounts.
  const pa = payoutDays([miner], NOW, 84800, 30, market).map((p) => p.btc);
  const pb = payoutDays([miner], NOW, 84800, 30, moved).map((p) => p.btc);
  assert.deepEqual(pa, pb);
});

test('payout days: one row per paid day, newest first, a zero day left out', () => {
  const rows = payoutDays([miner], NOW, 84800, 30, market);
  assert.deepEqual(rows.map((r) => r.at), [D17 + 2 * DAY, D17 + DAY]); // paid at the end of 17 and 18 Oct (19 Oct paid nothing)
  near(rows[0].btc, 1 / 90000, 1e-12);
  near(rows[1].btc, 2 / 80000, 1e-12);
});

test('a day with no snapshot uses the static daily amount and static BTC price, with no wobble', () => {
  const e = buildEarnings([miner], NOW, 84800, null);
  assert.deepEqual(e.earnings.week.map((w) => w.usd), [0, 0, 0, 1.98, 1.98, 1.98, 0.99]);
  near(e.totalBtc, (1.98 * 3 + 0.99) / 84800, 1e-10);
  // A market with no row for those days behaves the same, except today follows the live rate.
  const only = buildEarnings([miner], NOW, 84800, { halls, days: {}, live: null });
  assert.deepEqual(only.earnings.week, e.earnings.week);
});

test('a hall without stated rates falls back to the static daily amount', () => {
  const odd = { ...miner, hall: 'nowhere' };
  const e = buildEarnings([odd], NOW, 84800, market);
  assert.deepEqual(e.earnings.week.map((w) => w.usd).slice(3, 6), [1.98, 1.98, 1.98]);
});

test('an offline miner earns nothing from today on', () => {
  const e = buildEarnings([{ ...miner, online: false }], NOW, 84800, market);
  assert.equal(e.earnings.week[6].usd, 0);
  assert.equal(e.earnings.week[3].usd, 2);
});

test('withLiveDaily shows today\'s estimate, and leaves miners alone without a live market', () => {
  const [c] = withLiveDaily([miner], market);
  assert.equal(c.dailyUsd, 1.98);
  const [d] = withLiveDaily([miner], { ...market, live: { gross: 0.03, btc: 80000 } });
  assert.equal(d.dailyUsd, 1);
  assert.equal(withLiveDaily([miner], { ...market, live: null })[0], miner);
  assert.equal(withLiveDaily([miner], null)[0], miner);
});

test('minerDaily lists the live finished days, a zero day included, with the BTC they came to', () => {
  const m = minerDaily(miner, NOW, market);
  assert.deepEqual(m.rows.map((r) => [r.day, r.usd]), [['19 Oct', 0], ['18 Oct', 1], ['17 Oct', 2]]);
  near(m.btc, 2 / 80000 + 1 / 90000, 1e-10);
  near(m.usd, 3, 1e-9);
});

test('usdPerDay is a whole day at that day\'s market', () => {
  near(usdPerDay(miner, D17 + 5, market, NOW), 2);
  near(usdPerDay(miner, D17 + DAY, market, NOW), 1);
  assert.equal(usdPerDay(miner, D17 + 2 * DAY, market, NOW), 0);
  near(usdPerDay(miner, NOW, market, NOW), 1.98); // today: live
  assert.equal(usdPerDay(miner, D17 - DAY, market, NOW), 1.98); // no snapshot: static
});
