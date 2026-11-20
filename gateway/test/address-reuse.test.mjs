// An unpaid BTC address goes to a new invoice ADDRESS_REUSE_HOURS after its invoice ended. One that ever saw money never does.
// Against a real Postgres (skipped without DATABASE_URL). Only our own invoices are aged, so other tests are not touched.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { q, closeDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { createInvoice, ADDRESS_REUSE_HOURS } from '../src/invoices.js';
import { endedInvoices } from '../src/settle.js';

process.env.BTC_XPUB = 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
process.env.RATE_SOURCE = 'static';
process.env.RATE_BTC_USD = '100000';

const skip = process.env.DATABASE_URL ? false : 'DATABASE_URL not set';
const run = `reuse-${Math.random().toString(36).slice(2, 8)}`;
let n = 0;
const make = async () => (await createInvoice({ ref: `${run}-${n++}`, usd: 20, network: 'btc', asset: 'btc' })).invoice;
const row = async (id) => (await q('SELECT * FROM invoices WHERE id = $1', [id])).rows[0];
// Ends the invoice `hours` ago.
const end = (id, hours) => q("UPDATE invoices SET status = 'expired', expires_at = now() - ($2::numeric * interval '1 hour') WHERE id = $1", [id, hours]);
const owners = async (address) => (await q('SELECT count(*)::int AS n FROM invoices WHERE network = $1 AND address = $2 AND released_at IS NULL', ['btc', address])).rows[0].n;
const txid = () => randomBytes(32).toString('hex');

before(async () => {
  if (!skip) await migrate();
});

after(async () => {
  if (!skip) {
    const mine = `${run}-%`;
    await q('DELETE FROM chain_txs WHERE invoice_id IN (SELECT id FROM invoices WHERE ref LIKE $1)', [mine]);
    await q('DELETE FROM webhook_outbox WHERE invoice_id IN (SELECT id FROM invoices WHERE ref LIKE $1)', [mine]);
    await q("DELETE FROM unmatched_txs WHERE network = 'btc' AND address IN (SELECT address FROM invoices WHERE ref LIKE $1)", [mine]);
    await q('DELETE FROM invoices WHERE ref LIKE $1', [mine]);
  }
  await closeDb();
});

test('an unpaid address is given to a new invoice once its invoice ended long enough ago', { skip }, async () => {
  const a = await make();
  await end(a.id, ADDRESS_REUSE_HOURS + 1);
  const b = await make();
  assert.equal(b.address, a.address);
  assert.equal(await owners(a.address), 1, 'one invoice owns the address');
  const old = await row(a.id);
  assert.ok(old.released_at, 'the old invoice is released');
  assert.equal(old.status, 'expired');
  const now = await row(b.id);
  assert.equal(now.deriv_index, old.deriv_index);
  assert.equal(now.released_at, null);
  const log = (await q("SELECT detail FROM audit_log WHERE action = 'invoice.create' AND subject = $1", [b.id])).rows[0];
  assert.equal(log.detail.reusedFrom, a.id);
});

test('an address is kept until the full time has passed', { skip }, async () => {
  const a = await make();
  await end(a.id, ADDRESS_REUSE_HOURS - 1);
  const b = await make();
  assert.notEqual(b.address, a.address);
  assert.equal((await row(a.id)).released_at, null);
});

test('an address that saw a payment is never given away', { skip }, async () => {
  const a = await make();
  await end(a.id, ADDRESS_REUSE_HOURS + 6);
  await q("INSERT INTO chain_txs (invoice_id, network, txid, vout, amount_atomic) VALUES ($1, 'btc', $2, 0, 1000)", [a.id, txid()]);
  const b = await make();
  assert.notEqual(b.address, a.address);
  assert.equal((await row(a.id)).released_at, null);
});

test('an address with a late payment kept aside is never given away', { skip }, async () => {
  const a = await make();
  await end(a.id, ADDRESS_REUSE_HOURS + 6);
  await q("INSERT INTO unmatched_txs (network, asset, address, txid, vout, amount_atomic) VALUES ('btc', 'btc', $1, $2, 0, 20000)", [a.address, txid()]);
  const b = await make();
  assert.notEqual(b.address, a.address);
  assert.equal((await row(a.id)).released_at, null);
});

test('invoices made at the same time never share an address', { skip }, async () => {
  const old = [await make(), await make(), await make()];
  for (const a of old) await end(a.id, ADDRESS_REUSE_HOURS + 10);
  const fresh = await Promise.all(Array.from({ length: 8 }, () => make()));
  assert.equal(new Set(fresh.map((i) => i.address)).size, 8);
  for (const i of fresh) assert.equal(await owners(i.address), 1);
  assert.equal((await Promise.all(old.map((o) => row(o.id)))).filter((r) => r.released_at).length, 3, 'all three were taken back');
});

test('a released invoice is no longer watched for late money', { skip }, async () => {
  const a = await make();
  await end(a.id, ADDRESS_REUSE_HOURS + 2);
  await q("INSERT INTO webhook_outbox (invoice_id, event, payload) VALUES ($1, 'expired', '{}'::jsonb)", [a.id]);
  assert.ok((await endedInvoices()).some((i) => i.id === a.id), 'watched while it owns the address');
  const b = await make();
  assert.equal(b.address, a.address);
  assert.equal((await endedInvoices()).some((i) => i.id === a.id), false, 'not watched once released');
});
