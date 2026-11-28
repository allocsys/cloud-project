// Saved days (lib/earnings.js freezeDays): saving moves no number, and a saved day never moves afterwards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDays, buildEarnings, payoutDays, minerDaily, usdPerDay, dayPrice } from '@/lib/earnings';
import { smartPlan } from '@/lib/smart';
import { halls } from '@/lib/data';

const DAY = 86400000;
const now = Date.parse('2026-12-20T12:00:00Z');
const today = Math.floor(now / DAY) * DAY;
const coinGross = (k) => 1 + [0.6, -0.5, 0.2, -0.9, 0.9, 0][k % 6] * 0.8; // swings far enough to move the reserve both ways
function market({ scale = 1, h = halls, until = today } = {}) {
  const days = {};
  const sd = {};
  const picks = {};
  for (let k = 60; k >= 0; k -= 1) {
    const d = today - k * DAY;
    if (d >= until) continue;
    days[d] = { gross: (0.0398 + (k % 5) * 0.001) * scale, btc: (85000 + k * 100) * scale };
    sd[d] = { BTC: coinGross(k) * scale };
    picks[d] = 'BTC';
  }
  return { days, live: { gross: 0.04, btc: 85000 }, halls: h, smart: { picks, days: sd, refs: { BTC: 1 }, floors: [{ from: 0, floor: 1 }], live: null }, guard: { paused: { [today - 7 * DAY]: ['tx-1'] }, smart: {}, manual: {} } };
}
const asic = (o = {}) => ({ serial: 'A', hall: 'tx-1', th: 100, days: 90, startedAt: today - 20 * DAY + 5 * 3600000, online: true, dailyUsd: 1, ...o });
const smart = (o = {}) => ({ ...smartPlan(1000, 90), serial: 'S', online: true, dailyUsd: 12, startedAt: today - 20 * DAY + 7 * 3600000, ...o });
const sums = (list, m, at = now) => {
  const e = buildEarnings(list, at, 85000, m);
  return { btc: e.totalBtc, usd: e.totalUsd, week: e.earnings.week.slice(0, 6), pay: payoutDays(list, at, 85000, 30, m), mine: list.map((c) => minerDaily(c, at, m, 85000)) };
};
const close = (a, b, path = '') => {
  if (typeof a === 'number') return assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a)), `${path}: ${a} != ${b}`);
  if (a && typeof a === 'object') {
    assert.deepEqual(Object.keys(b), Object.keys(a), path);
    for (const k of Object.keys(a)) close(a[k], b[k], `${path}.${k}`);
  } else assert.equal(b, a, path);
};
// Another market and other hall rates for everything: what a saved day must not notice.
const changed = () => market({ scale: 0.5, h: { ...halls, 'tx-1': { ...halls['tx-1'], power: 'Grid, $0.01/kWh' } } });

test('saving moves no number, and nothing saved moves when the market and rates change', () => {
  const list = [asic(), smart()];
  const m = market();
  const before = sums(structuredClone(list), m);
  for (const c of list) assert.notEqual(sums([structuredClone(c)], changed()).btc, sums([structuredClone(c)], m).btc, 'control: unsaved days do move');
  for (const c of list) assert.ok(freezeDays(c, now, m, today - DAY) >= 20);
  close(before, sums(list, m));
  const later = sums(list, changed());
  close(before.pay, later.pay);
  close(before.week, later.week);
  close(before.mine, later.mine);
  assert.equal(freezeDays(list[0], now, changed(), today - DAY), 0, 'a saved day is never written again');
});

test('saved a few days at a time, the Smart reserve carries on as if it had never stopped', () => {
  const m = market();
  const whole = sums([smart()], m);
  const c = smart();
  for (let k = 18; k >= 1; k -= 4) {
    freezeDays(c, today - (k - 1) * DAY + 3600000, m, today - k * DAY);
    close(whole, sums([c], m));
  }
});

test('a whole term: the last day keeps the reserve share, and the miner is marked done', () => {
  const m = market();
  const mk = () => smart({ startedAt: today - 50 * DAY + 3600000, days: 40, baseYield: smartPlan(1000, 90).baseYield });
  const whole = sums([mk()], m);
  const a = mk();
  freezeDays(a, today - 30 * DAY, m, today - 31 * DAY);
  assert.equal(a.logDone, undefined);
  freezeDays(a, now, m, today - DAY);
  assert.equal(a.logDone, true);
  close(whole, sums([a], m));
  close(whole, sums([a], changed()));
});

test('invite rewards read saved days, also past the end of a term', () => {
  const m = market();
  const c = asic({ days: 5 });
  const until = today - 4 * DAY;
  const read = (mm) => Array.from({ length: 16 }, (_, k) => today - (20 - k) * DAY).map((d) => usdPerDay(c, d, mm, now) / dayPrice(c, d, mm, now));
  const before = read(m);
  const sumBefore = sums([structuredClone(c)], m);
  freezeDays(c, now, m, today - DAY, { until });
  close(before, read(changed()));
  close(sumBefore, sums([c], m));
});

test('waiting invite rewards keep a miner open; offline and sample miners are left alone', () => {
  const m = market();
  const c = asic({ days: 5 });
  freezeDays(c, now, m, today - DAY, { open: true });
  assert.equal(c.logDone, undefined);
  assert.equal(freezeDays(asic({ online: false }), now, m, today - DAY), 0);
  assert.equal(freezeDays(asic({ startedAt: undefined }), now, m, today - DAY), 0);
});
