// Admin overview tests. The auth test needs no database; the overview test uses a real Postgres (skipped without DATABASE_URL).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { q, closeDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { adminOverview } from '../src/admin-api.js';
import { handler } from '../src/server.js';

const skip = process.env.DATABASE_URL ? false : 'DATABASE_URL not set';
const run = Math.random().toString(36).slice(2, 8);
const net = `test-adm-${run}`;
const SECRET = 'admin-test-secret-0123456789';

const serve = () =>
  new Promise((resolve) => {
    const s = createServer((req, res) => handler(req, res));
    s.listen(0, '127.0.0.1', () => resolve(s));
  });

before(async () => {
  process.env.GATEWAY_API_SECRET = SECRET;
  if (!skip) await migrate();
});

after(async () => {
  if (!skip) {
    await q('DELETE FROM unmatched_txs WHERE address = $1', [`bc1q${run}`]);
    await q('DELETE FROM chain_cursors WHERE network = $1', [net]);
  }
  await closeDb();
});

test('the admin overview needs the Bearer secret', async () => {
  const s = await serve();
  try {
    const base = `http://127.0.0.1:${s.address().port}/v1/admin/overview`;
    assert.equal((await fetch(base)).status, 401);
    assert.equal((await fetch(base, { headers: { authorization: 'Bearer wrong-secret-0123456789' } })).status, 401);
  } finally {
    s.close();
  }
});

test('the overview lists networks, scanners, invoices, unmatched payments, callbacks and the audit log', { skip }, async () => {
  await q('INSERT INTO chain_cursors (network, height, hash, tip) VALUES ($1, 100, $2, 103)', [net, `0x${'a'.repeat(64)}`]);
  await q("INSERT INTO unmatched_txs (network, asset, address, txid, vout, amount_atomic, confirmations) VALUES ('btc', 'btc', $1, $2, 0, 12345, 3)", [`bc1q${run}`, `${run}`.padEnd(64, 'e')]);
  const o = await adminOverview();
  assert.deepEqual(
    o.networks.map((n) => n.network),
    ['btc', 'eth', 'bsc', 'pol', 'trx', 'sol'],
  );
  assert.ok(o.networks.every((n) => Array.isArray(n.assets) && typeof n.configured === 'boolean'));
  const s = o.scanners.find((x) => x.network === net);
  assert.equal(s.height, '100');
  assert.equal(s.tip, '103');
  assert.ok(s.age_s >= 0);
  assert.equal(typeof o.invoices.counts, 'object');
  assert.ok(Array.isArray(o.invoices.recent));
  assert.ok(o.unmatched.total >= 1);
  const u = o.unmatched.recent.find((x) => x.address === `bc1q${run}`);
  assert.equal(u.amount, '0.00012345');
  assert.equal(typeof o.callbacks.pending, 'number');
  assert.equal(typeof o.callbacks.failing, 'number');
  assert.ok(Array.isArray(o.callbacks.stuck));
  assert.ok(Array.isArray(o.audit));
});
