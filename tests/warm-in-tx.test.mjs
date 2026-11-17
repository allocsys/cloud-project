// Inside a transaction warm() must not ask the pool for another connection: when every connection is held by a transaction that
// waits for one more, they all wait until the connection timeout. Here the settings copy is made stale, then as many
// transactions as the pool holds all call warm() at once: they must finish at once.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, tx, warm } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');

before(async () => {
  await migrate();
  await warm(true); // loads the copy once, so it is not "never loaded"
});

after(async () => {
  await pool().end();
});

test('warm() inside a transaction does not need a second pool connection', async () => {
  const meta = globalThis.__vtxPg.meta;
  meta.at = 1; // old, but loaded
  const n = pool().options.max;
  const t0 = Date.now();
  await Promise.all(
    Array.from({ length: n }, () =>
      tx(async (c) => {
        await c.query('SELECT 1');
        await warm();
        await c.query('SELECT 1');
      }),
    ),
  );
  assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0} ms`);
  assert.equal(meta.at, 1, 'the copy was not refreshed inside the transactions');
  await warm(); // outside a transaction it refreshes as before
  assert.ok(meta.at > 1);
});
