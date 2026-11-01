// recordCoins writes only while the real clock is inside the day the rows belong to. `now` is taken before the feeds answer, so a call
// that began before 00:00 UTC could land after it and change a finished day's row after the picks and the guard had decided from it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, q } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const { recordCoins } = await import('@/lib/server/smart-market');

const DAY = 86400000;
const today = Math.floor(Date.now() / DAY) * DAY;
const finished = today - 40 * DAY;
const live = (net) => ({ BTC: { gross: 0.04, net, price: 100000 } });
const rowOf = async (day) => (await q("SELECT net_per_rig FROM coin_days WHERE day = $1 AND coin = 'BTC'", [day])).rows;

const wipe = () => q("DELETE FROM coin_days WHERE coin = 'BTC' AND day = ANY($1)", [[finished, today]]);
let seeds = []; // recordCoins sets the shared Smart anchor when none exists; put it back so other tests see what they expect

before(async () => {
  await migrate();
  seeds = (await q('SELECT symbol, ref_net FROM smart_coins')).rows;
  await wipe();
});

after(async () => {
  await wipe();
  for (const s of seeds) await q('UPDATE smart_coins SET ref_net = $2 WHERE symbol = $1', [s.symbol, s.ref_net]);
  await pool().end();
});

test('a call that began in a day that is over writes nothing, new row or old', async () => {
  await recordCoins(finished + 12 * 3600_000, live(1.5));
  assert.equal((await rowOf(finished)).length, 0, 'no row is made for a finished day');
  await q("INSERT INTO coin_days (day, coin, price_usd, gross_per_unit, net_per_rig, at) VALUES ($1, 'BTC', 100000, 0.04, 1, $2)", [finished, finished + 1000]);
  await recordCoins(finished + 13 * 3600_000, live(9));
  assert.equal(Number((await rowOf(finished))[0].net_per_rig), 1, 'a decided day keeps its row');
});

test('a call inside the open day writes its rows', async () => {
  await recordCoins(Date.now(), live(2));
  const r = await rowOf(today);
  assert.equal(r.length, 1);
  assert.equal(Number(r[0].net_per_rig), 2);
});
