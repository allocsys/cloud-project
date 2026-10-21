// Real hashrate and uptime from hall samples (pure maths), then the feed and the admin's mock/real switch against Postgres.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { realHash, uptimeOf, realMinerHash, minerCharts, mockMinerHash, mockMinerUptime } from '../lib/telemetry.js';
import { buildEarnings } from '../lib/earnings.js';

const { pool, q } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const { ingest, loadSamples, telemetryFor, mockCharts, setMockCharts, feedStatus, checkKey, feedEnabled } = await import('@/lib/server/telemetry');
const { act, overview } = await import('@/lib/server/admin');

await migrate();
const serial = `OP-${String(Date.now() % 1e7).padStart(7, '0')}`;

after(async () => {
  await q('DELETE FROM hash_samples WHERE serial = $1', [serial]);
  await setMockCharts(true);
  await pool().end();
});

const HOUR = 3600000;
const DAY = 86400000;
const D17 = Date.parse('2026-10-17T00:00:00Z');
const D18 = D17 + DAY;
const D19 = D18 + DAY;
const NOW = Date.parse('2026-10-20T12:00:00Z');

const m = { serial: 'OP-0000001', th: 100, start: D17, stop: NOW };

// One sample at :10 of every hour from 18 Oct 00:00 to 20 Oct 11:10, 100 TH/s. On 19 Oct 16:00 to 21:59 the miner ran at
// 50 TH/s (too low to count as up), and the 22:00 hour has no sample at all.
function samples() {
  const out = [];
  for (let t = D18 + 10 * 60000; t < NOW; t += HOUR) {
    const h = Math.floor((t - D19) / HOUR);
    if (t >= D19 && t < D19 + DAY && h === 22) continue;
    out.push({ at: t, th: t >= D19 && h >= 16 && h <= 21 ? 50 : 100 });
  }
  return out;
}

test('fleet hashrate is the average of what was reported in each 3 hour slot', () => {
  const h = realHash([m], { [m.serial]: samples() }, NOW);
  assert.deepEqual(h, [100, 66.7, 50, 75, 100, 100, 100, 100]);
});

test('no samples means no hashrate and no uptime, not a flat line or a made-up figure', () => {
  assert.equal(realHash([m], {}, NOW), null);
  const u = uptimeOf([m], {}, NOW);
  assert.equal(u.pct, null);
  assert.ok(u.series.every((d) => d.pct === null));
});

test('uptime counts whole hours: a low or missing hour is down, time before monitoring is not counted', () => {
  const u = uptimeOf([m], { [m.serial]: samples() }, NOW);
  // 14 to 17 Oct were before the first sample. 18 Oct: 24 of 24. 19 Oct: 6 low hours and 1 missing, so 17 of 24.
  // 20 Oct: the 12 hours that are over, all up.
  assert.deepEqual(u.series.map((d) => d.pct), [null, null, null, null, 100, 70.8, 100]);
  assert.equal(u.series[6].label, 'Today');
  assert.equal(u.pct, 88.3); // 53 of 60 counted hours
});

test('uptime is weighted by contracted TH/s across miners', () => {
  const big = { serial: 'OP-0000002', th: 300, start: D17, stop: NOW };
  const clean = [];
  for (let t = D18 + 10 * 60000; t < NOW; t += HOUR) clean.push({ at: t, th: 300 });
  const both = uptimeOf([m, big], { [m.serial]: samples(), [big.serial]: clean }, NOW);
  const mine = uptimeOf([m], { [m.serial]: samples() }, NOW);
  assert.equal(both.pct, 97.1); // 23300 of 24000 TH-hours
  assert.ok(both.pct > mine.pct);
});

test('a miner that is offline since today counts no hours today', () => {
  const off = { ...m, stop: Math.floor(NOW / DAY) * DAY };
  assert.equal(uptimeOf([off], { [off.serial]: samples() }, NOW).series[6].pct, null);
});

test('one miner: 24 hourly points, a current reading only when it is fresh', () => {
  const r = realMinerHash(m, samples(), NOW);
  assert.equal(r.series.length, 24);
  assert.equal(r.series[22], 100); // the 11:00 hour
  assert.equal(r.series[23], 0); // 12:00 has no sample yet
  assert.equal(r.hasData, true);
  assert.equal(r.now, 0); // the last sample is 50 minutes old
  const fresh = realMinerHash(m, [...samples(), { at: NOW - 60000, th: 98.5 }], NOW);
  assert.equal(fresh.now, 98.5);
  assert.equal(realMinerHash(m, [], NOW).hasData, false);
});

test('minerCharts: no list is the mock, a list is real', () => {
  const c = { serial: m.serial, th: 100, online: true };
  assert.equal(minerCharts(c, D17, NOW, null, NOW).real, false);
  assert.equal(minerCharts(c, D17, NOW, null, NOW).hash.hasData, true);
  const real = minerCharts(c, D17, NOW, [], NOW);
  assert.equal(real.real, true);
  assert.equal(real.hash.hasData, false);
  assert.equal(real.uptime.pct, null);
  assert.equal(mockMinerHash({ ...c, online: false }).now, 0);
  assert.ok(mockMinerUptime(m, NOW).pct >= 99.6);
});

test('the dashboard takes real hashrate and uptime when given samples, and the old mock without', () => {
  const c = { serial: m.serial, name: 'T', th: 100, hall: 'is-2', days: 180, startedAt: D17, online: true, dailyUsd: 1.98 };
  const real = buildEarnings([c], NOW, 84800, null, { samples: { [c.serial]: samples() } });
  assert.equal(real.chartsReal, true);
  assert.equal(real.uptime, 88.3);
  assert.equal(real.stats.hash.length, 8);
  const none = buildEarnings([c], NOW, 84800, null, { samples: {} });
  assert.deepEqual(none.stats.hash, []);
  assert.equal(none.uptime, null);
  const mock = buildEarnings([c], NOW, 84800, null, null);
  assert.equal(mock.chartsReal, false);
  assert.ok(mock.uptime >= 99.6 && mock.stats.hash.length === 8);
});

// ---- Against Postgres ----

test('the feed keeps good rows, skips bad ones, and the last write for a moment wins', async () => {
  const now = Date.now();
  const r = await ingest(
    [
      { serial, th: 110.1234, at: now - 2 * HOUR },
      { serial, th: 111, at: now - HOUR },
      { serial, th: 112 }, // no "at": now
      { serial, th: 1, at: now - HOUR }, // same moment again: replaces the 111
      { serial: 'nope', th: 5 },
      { serial, th: -5 },
      { serial, th: 'x' },
      { serial, th: 5, at: now + DAY },
      { serial, th: 5, at: now - 30 * DAY },
    ],
    now,
  );
  assert.deepEqual(r, { accepted: 3, rejected: 5 });
  const got = (await loadSamples([serial], now))[serial];
  assert.deepEqual(got.map((s) => s.th), [110.123, 1, 112]);
  assert.ok(got[0].at < got[1].at && got[1].at < got[2].at);
  assert.deepEqual(await loadSamples([], now), {});
  assert.deepEqual(await ingest('not a list'), { accepted: 0, rejected: 0 });
});

test('the feed status counts what arrived', async () => {
  const s = await feedStatus();
  assert.ok(s.samples >= 3 && s.miners >= 1 && s.last > 0);
});

test('the key check is off without TELEMETRY_KEY and exact with it', () => {
  const before = process.env.TELEMETRY_KEY;
  try {
    delete process.env.TELEMETRY_KEY;
    assert.equal(feedEnabled(), false);
    assert.equal(checkKey('anything'), false);
    process.env.TELEMETRY_KEY = 'short';
    assert.equal(feedEnabled(), false);
    process.env.TELEMETRY_KEY = 'a-long-enough-key-123';
    assert.equal(feedEnabled(), true);
    assert.equal(checkKey('a-long-enough-key-123'), true);
    assert.equal(checkKey('a-long-enough-key-124'), false);
    assert.equal(checkKey(undefined), false);
  } finally {
    if (before === undefined) delete process.env.TELEMETRY_KEY;
    else process.env.TELEMETRY_KEY = before;
  }
});

test('the admin switch flips mock and real, and telemetryFor follows it', async () => {
  const contracts = [{ serial }];
  assert.equal((await act({ action: 'charts-mock', mode: 'sideways' })).ok, false);

  const real = await act({ action: 'charts-mock', mode: 'real' });
  assert.equal(real.ok, true);
  assert.equal(real.mock, false);
  assert.equal(await mockCharts(), false);
  assert.equal((await overview()).charts.mock, false);
  const tel = await telemetryFor(contracts, Date.now());
  assert.equal(tel.samples[serial].length, 3);

  const mock = await act({ action: 'charts-mock', mode: 'mock' });
  assert.equal(mock.mock, true);
  assert.equal(await telemetryFor(contracts, Date.now()), null);
  assert.equal((await overview()).charts.mock, true);
});
