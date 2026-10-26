// Smart Mining's daily picks against a real Postgres: written once per finished day from that day's own rows, the previous
// coin held inside the hysteresis, a day with no data keeps the coin, today is never written, and a written day is locked.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, q } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const { ensurePicks } = await import('@/lib/server/smart-market');

const DAY = 86400000;
const today = Math.floor(Date.now() / DAY) * DAY;
const wipe = async () => {
  await q('DELETE FROM smart_picks');
  await q('DELETE FROM coin_days');
  await q('UPDATE smart_coins SET ref_gross = NULL, ref_net = NULL');
};
// The pick compares net profit per reference rig; with the anchor at 1 below, the value is the ratio.
const row = (day, coin, gross) =>
  q('INSERT INTO coin_days (day, coin, price_usd, gross_per_unit, net_per_rig, at) VALUES ($1, $2, 1, $3, $3, $4)', [day, coin, String(gross), day + 1000]);

before(async () => {
  await migrate();
  await wipe();
});

after(async () => {
  await wipe();
  await pool().end();
});

test('the seeded coins are BTC (asic) and four gpu_cpu coins, all enabled', async () => {
  const r = await q('SELECT symbol, kind, enabled FROM smart_coins ORDER BY sort');
  assert.deepEqual(r.rows.map((x) => x.symbol), ['BTC', 'KAS', 'RVN', 'XMR', 'ETC']);
  assert.equal(r.rows[0].kind, 'asic');
  assert.ok(r.rows.slice(1).every((x) => x.kind === 'gpu_cpu'));
  assert.ok(r.rows.every((x) => x.enabled));
});

test('picks follow each day, hold inside the hysteresis, keep the coin on a day without data, and lock', async () => {
  await q("UPDATE smart_coins SET ref_gross = 1, ref_net = 1 WHERE symbol IN ('BTC', 'KAS', 'RVN', 'XMR')");
  const d = (k) => today - k * DAY;
  await row(d(4), 'BTC', 1);
  await row(d(4), 'KAS', 1.5); // KAS is far ahead: KAS
  await row(d(3), 'KAS', 1);
  await row(d(3), 'BTC', 1.02); // BTC leads by 2%, inside the 3% hysteresis: KAS stays
  // d(2) has no rows at all: KAS stays
  await row(d(1), 'BTC', 2);
  await row(d(1), 'KAS', 1); // BTC is far ahead: BTC
  assert.equal(await ensurePicks(Date.now()), 4);
  const picks = (await q('SELECT day, coin FROM smart_picks ORDER BY day')).rows.map((p) => [Number(p.day), p.coin]);
  assert.deepEqual(picks, [
    [d(4), 'KAS'],
    [d(3), 'KAS'],
    [d(2), 'KAS'],
    [d(1), 'BTC'],
  ]);
  // Today is never written, and a second run changes nothing.
  assert.ok(!picks.some(([day]) => day === today));
  await q("UPDATE coin_days SET gross_per_unit = 9, net_per_rig = 9 WHERE coin = 'KAS'");
  assert.equal(await ensurePicks(Date.now()), 0);
  const again = (await q('SELECT day, coin FROM smart_picks ORDER BY day')).rows.map((p) => [Number(p.day), p.coin]);
  assert.deepEqual(again, picks);
});
