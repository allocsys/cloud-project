// Closing a waiting invoice by hand. Needs a real Postgres (skipped without DATABASE_URL).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { q, closeDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { closeInvoice } from '../src/admin-api.js';

const skip = process.env.DATABASE_URL ? false : 'DATABASE_URL not set';
const run = Math.random().toString(36).slice(2, 8);
const ids = [];

async function make(status = 'pending') {
  const n = ids.length;
  const id = `inv_close_${run}_${n}`;
  ids.push(id);
  await q(
    `INSERT INTO invoices (id, ref, kind, network, asset, address, deriv_index, usd, expected_atomic, status, expires_at)
     VALUES ($1, $2, 'order', 'btc', 'btc', $3, $4, 31, 100000, $5, now() + interval '1 hour')`,
    [id, `ord_${id}`, `bc1q${run}c${n}`, 9_000_000_000 + Math.floor(Math.random() * 1_000_000_000), status],
  );
  return id;
}

const state = async (id) => (await q('SELECT status FROM invoices WHERE id = $1', [id])).rows[0].status;
const events = async (id) => (await q('SELECT event, payload FROM webhook_outbox WHERE invoice_id = $1', [id])).rows;

before(async () => {
  if (!skip) await migrate();
});

after(async () => {
  if (!skip && ids.length) {
    await q('DELETE FROM webhook_outbox WHERE invoice_id = ANY($1)', [ids]);
    await q('DELETE FROM chain_txs WHERE invoice_id = ANY($1)', [ids]);
    await q('DELETE FROM invoices WHERE id = ANY($1)', [ids]);
  }
  await closeDb();
});

test('closing a waiting invoice expires it, queues one expired callback and audits it', { skip }, async () => {
  const id = await make();
  assert.deepEqual(await closeInvoice({ id }), { closed: true, already: false });
  assert.equal(await state(id), 'expired');
  const ev = await events(id);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].event, 'expired');
  assert.equal(ev[0].payload.payment_status, 'expired');
  assert.equal(ev[0].payload.order_id, `ord_${id}`);
  assert.equal((await q("SELECT 1 FROM audit_log WHERE action = 'invoice.closed' AND subject = $1", [id])).rowCount, 1);

  // Repeating changes nothing.
  assert.deepEqual(await closeInvoice({ id }), { closed: true, already: true });
  assert.equal((await events(id)).length, 1);
  assert.equal((await q("SELECT 1 FROM audit_log WHERE action = 'invoice.closed' AND subject = $1", [id])).rowCount, 1);
});

test('an invoice that is paid, or has a payment on it, cannot be closed', { skip }, async () => {
  const paid = await make('paid');
  await assert.rejects(closeInvoice({ id: paid }), (e) => e.status === 409);
  assert.equal(await state(paid), 'paid');

  const seen = await make();
  await q("INSERT INTO chain_txs (invoice_id, network, txid, vout, amount_atomic, confirmations) VALUES ($1, 'btc', $2, 0, 5000, 0)", [seen, randomBytes(32).toString('hex')]);
  await assert.rejects(closeInvoice({ id: seen }), (e) => e.status === 409);
  assert.equal(await state(seen), 'pending');
  assert.equal((await events(seen)).length, 0);
});

test('bad input is 400 and an unknown invoice is 404', { skip }, async () => {
  await assert.rejects(closeInvoice({}), (e) => e.status === 400);
  await assert.rejects(closeInvoice({ id: 'x'.repeat(200) }), (e) => e.status === 400);
  await assert.rejects(closeInvoice({ id: `nope_${run}` }), (e) => e.status === 404);
});
