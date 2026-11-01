// The admin overview must show the balance the user sees. Before this fix the overview worked out each balance without the market,
// so a miner paid by the real market days looked richer (static daily amount) on the admin Users tab than in the user's own wallet.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, q, tx, createUser } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const { overview } = await import('@/lib/server/admin');
const { getWallet } = await import('@/lib/server/wallet');
const { BTC_USD } = await import('@/lib/data');

const DAY = 86400000;
const today = Math.floor(Date.now() / DAY) * DAY;
const d = (k) => today - k * DAY;
const ID = `ovmarket${Date.now().toString(36)}@test.dev`;
const days = [5, 4, 3, 2, 1].map(d);

before(async () => {
  await migrate();
  // Five finished days where the market pays far below the hall's costs: the miner earned nothing on each of them.
  for (const day of days) {
    await q(
      `INSERT INTO market_days (day, btc_usd, difficulty, gross_per_th, at) VALUES ($1, 100000, 1, 0.0001, $2)
       ON CONFLICT (day) DO UPDATE SET btc_usd = 100000, gross_per_th = 0.0001, at = EXCLUDED.at`,
      [day, day + 1000],
    );
  }
  await tx((c) =>
    createUser(c, ID, { contracts: [{ serial: 'VTX-9000201', name: 'Overview market', plan: 'Custom', th: 10, hall: 'tx-1', online: true, days: 90, startedAt: d(5), dailyUsd: 1, price: 100, status: 'active' }] }),
  );
});

after(async () => {
  await q('DELETE FROM users WHERE id = $1', [ID]);
  await q('DELETE FROM market_days WHERE day = ANY($1)', [days]);
  await pool().end();
});

test('the admin overview balance matches the wallet when the market differs from the static daily amount', async () => {
  const w = await getWallet(ID);
  const wallet = w.earned - w.withdrawn - w.spent;
  // Static would be about five dollars of BTC; the market paid nothing on those days.
  assert.ok(wallet < 2 / BTC_USD, `the wallet follows the market (${wallet})`);
  const shown = (await overview()).users.find((u) => u.id === ID);
  assert.ok(shown, 'the user is listed');
  assert.ok(Math.abs(shown.available - wallet) < 1e-7, `admin ${shown.available} vs wallet ${wallet}`);
  assert.ok(Math.abs(shown.earned - w.earned) < 1e-7, `earned ${shown.earned} vs wallet ${w.earned}`);
});
