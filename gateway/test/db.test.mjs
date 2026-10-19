// Schema tests. They need a real Postgres (DATABASE_URL) and are skipped without one.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { q, closeDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';

const skip = process.env.DATABASE_URL ? false : 'DATABASE_URL not set';
const net = `tnet-${Math.random().toString(36).slice(2, 8)}`;
let idx = 0;

const addInvoice = (id, o = {}) =>
  q(
    `INSERT INTO invoices (id, ref, network, asset, address, deriv_index, expires_at, status)
     VALUES ($1, $2, $3, 'btc', $4, $5, now() + interval '1 hour', $6)`,
    [id, `test-${id}`, net, o.address ?? `addr-${id}`, o.index ?? idx++, o.status ?? 'pending'],
  );

const code = (c) => (e) => e.code === c;

before(async () => {
  if (!skip) await migrate();
});

after(async () => {
  if (!skip) {
    await q("DELETE FROM chain_txs WHERE network = $1", [net]);
    await q("DELETE FROM webhook_outbox WHERE invoice_id LIKE 'tinv-%'");
    await q('DELETE FROM invoices WHERE network = $1', [net]);
    await q('DELETE FROM address_counters WHERE network = $1', [net]);
  }
  await closeDb();
});

test('migrations run once, even when started together', { skip }, async () => {
  await Promise.all([migrate(), migrate(), migrate()]);
  const r = await q("SELECT count(*)::int AS n FROM schema_migrations WHERE id = '001_deposits'");
  assert.equal(r.rows[0].n, 1);
});

test('all gateway tables exist', { skip }, async () => {
  const r = await q("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
  const have = new Set(r.rows.map((x) => x.table_name));
  for (const t of ['address_counters', 'invoices', 'chain_txs', 'webhook_outbox', 'audit_log', 'schema_migrations']) assert.ok(have.has(t), `missing ${t}`);
});

test('audit_log is append-only', { skip }, async () => {
  const r = await q("INSERT INTO audit_log (actor, action, subject) VALUES ('test', 'check', 'x') RETURNING id");
  const id = r.rows[0].id;
  await assert.rejects(q("UPDATE audit_log SET action = 'changed' WHERE id = $1", [id]), /append-only/);
  await assert.rejects(q('DELETE FROM audit_log WHERE id = $1', [id]), /append-only/);
});

test('an address and a derivation index are never reused on a network', { skip }, async () => {
  await addInvoice('tinv-a', { address: 'same', index: 9001 });
  await assert.rejects(addInvoice('tinv-b', { address: 'same', index: 9002 }), code('23505'));
  await assert.rejects(addInvoice('tinv-c', { address: 'other', index: 9001 }), code('23505'));
});

test('invoice status is restricted', { skip }, async () => {
  await assert.rejects(addInvoice('tinv-d', { status: 'bogus' }), code('23514'));
});

test('the same chain payment is counted once', { skip }, async () => {
  await addInvoice('tinv-e');
  const ins = () =>
    q(
      `INSERT INTO chain_txs (invoice_id, network, txid, vout, amount_atomic) VALUES ('tinv-e', $1, 'tx1', 0, 1000)
       ON CONFLICT (network, txid, vout) DO NOTHING`,
      [net],
    );
  assert.equal((await ins()).rowCount, 1);
  assert.equal((await ins()).rowCount, 0);
  await assert.rejects(q("INSERT INTO chain_txs (invoice_id, network, txid, amount_atomic) VALUES ('tinv-e', $1, 'tx2', 0)", [net]), code('23514'));
});

test('one webhook per invoice and event', { skip }, async () => {
  await addInvoice('tinv-f');
  const ins = () =>
    q("INSERT INTO webhook_outbox (invoice_id, event, payload) VALUES ('tinv-f', 'finished', '{}') ON CONFLICT (invoice_id, event) DO NOTHING");
  assert.equal((await ins()).rowCount, 1);
  assert.equal((await ins()).rowCount, 0);
});

test('parallel address counters never hand out the same index', { skip }, async () => {
  const take = () =>
    q(
      `INSERT INTO address_counters (network, next_index) VALUES ($1, 1)
       ON CONFLICT (network) DO UPDATE SET next_index = address_counters.next_index + 1
       RETURNING next_index - 1 AS idx`,
      [net],
    ).then((r) => Number(r.rows[0].idx));
  const got = await Promise.all(Array.from({ length: 25 }, take));
  assert.equal(new Set(got).size, 25);
  assert.equal(Math.min(...got), 0);
  assert.equal(Math.max(...got), 24);
});
