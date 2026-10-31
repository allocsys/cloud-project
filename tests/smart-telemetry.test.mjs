import test from 'node:test';
import assert from 'node:assert/strict';
import { uptimeOf, realHash, realMinerHash, minerCharts } from '@/lib/telemetry';

const DAY = 86400000;
const now = Date.UTC(2026, 9, 21, 12, 30); // 12:30 UTC
const at = (hour, min = 10) => Date.UTC(2026, 9, 21, hour, min);
const start = Date.UTC(2026, 9, 21, 6, 0);
const smart = (rateAt) => ({ serial: 'VTX-0000001', th: 0, start, stop: start + 150 * DAY, rateAt, weight: 1 });

test('Smart uptime: an hour is up when a sample reaches 90% of the contracted rate of that hour', () => {
  // Reports for 07-09 at 95 of a contracted 100 (up), 10 at 50 (down), nothing for 11 (down): 3 of 5 whole hours.
  const samples = { 'VTX-0000001': [at(7), at(8), at(9)].map((t) => ({ at: t, th: 95 })).concat([{ at: at(10), th: 50 }]) };
  const r = uptimeOf([smart(() => 100)], samples, now);
  assert.equal(r.series[6].pct, 60);
  assert.equal(r.pct, 60);
});

test('Smart uptime: the rate can change by hour (another coin) and the bar moves with it', () => {
  // From 09:00 the contracted rate is 1000 (another coin, another unit): a report of 95 is then too low.
  const samples = { 'VTX-0000001': [at(7), at(8), at(9), at(10)].map((t) => ({ at: t, th: 95 })) };
  const r = uptimeOf([smart((h) => (h < at(9, 0) ? 100 : 1000))], samples, now);
  assert.equal(r.series[6].pct, 40); // 07 and 08 up; 09, 10 and 11 down
});

test('Smart uptime: hours whose contract is unknown are not counted', () => {
  const samples = { 'VTX-0000001': [at(7), at(8), at(9), at(10)].map((t) => ({ at: t, th: 95 })) };
  const r = uptimeOf([smart((h) => (h < at(9, 0) ? null : 100))], samples, now);
  assert.equal(r.series[6].pct, 66.7); // 09 and 10 up, 11 down
});

test('Smart uptime: nothing to count gives null, not zero', () => {
  const r = uptimeOf([smart(() => 100)], {}, now);
  assert.equal(r.pct, null);
  assert.ok(r.series.every((d) => d.pct === null));
});

test('the fleet uptime weighs a Smart miner by its weight, not by its own unit', () => {
  const asic = { serial: 'VTX-0000002', th: 10, start, stop: start + 90 * DAY };
  const samples = {
    'VTX-0000002': [at(7), at(8), at(9), at(10), at(11)].map((t) => ({ at: t, th: 10 })), // 5 of 5 up, weight 10
    'VTX-0000001': [at(7), at(8), at(9), at(10), at(11)].map((t) => ({ at: t, th: 0 })), // 0 of 5 up, weight 10
  };
  const r = uptimeOf([asic, { ...smart(() => 100), weight: 10 }], samples, now);
  assert.equal(r.pct, 50);
});

test('the fleet hashrate leaves Smart miners out', () => {
  const samples = { 'VTX-0000001': [{ at: at(11), th: 95 }] };
  assert.equal(realHash([smart(() => 100)], samples, now), null);
});

test('a Smart miner page: real hashrate in the coin unit, made-up one follows the contracted rate', () => {
  const list = [{ at: at(12, 5), th: 97 }];
  const real = realMinerHash(smart(() => 100), list, now);
  assert.equal(real.hasData, true);
  assert.equal(real.now, 97);
  const c = { serial: 'VTX-0000001', th: 0, online: true, smart: true };
  const mock = minerCharts(c, start, start + 150 * DAY, null, now, () => 200);
  assert.equal(mock.real, false);
  assert.ok(mock.hash.now > 190 && mock.hash.now <= 200);
  const rl = minerCharts(c, start, start + 150 * DAY, list, now, () => 100);
  assert.equal(rl.real, true);
  assert.equal(rl.hash.now, 97);
});
