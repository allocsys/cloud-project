// The invoice amount carries a safety margin (default 2%) and an invoice lives ten minutes (default). Real Postgres (skipped without DATABASE_URL).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { q, closeDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { createInvoice } from '../src/invoices.js';
import { observe } from '../src/settle.js';

const ZPUB = 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
process.env.BTC_XPUB = ZPUB;
process.env.RATE_SOURCE = 'static';
process.env.RATE_BTC_USD = '100000';
// The package test script switches the margin off for the other files; this one tests it, so it sets its own values.
process.env.INVOICE_BUFFER_PERCENT = '2';
delete process.env.INVOICE_TTL_MINUTES;

const skip = process.env.DATABASE_URL ? false : 'DATABASE_URL not set';
const run = `test-margin-${Math.random().toString(36).slice(2, 8)}`;
let n = 0;
const mk = async (usd = 50) => (await createInvoice({ ref: `${run}-${n++}`, usd })).invoice;
const txid = (s) => createHash('sha256').update(`${run}-${s}`).digest('hex');
const pay = (name, amount) => ({ txid: txid(name), vout: 0, amount: String(amount), confirmations: 1, height: 800000 });

before(async () => {
  if (!skip) await migrate();
});

after(async () => {
  if (!skip) {
    const ids = `SELECT id FROM invoices WHERE ref LIKE '${run}-%'`;
    await q(`DELETE FROM webhook_outbox WHERE invoice_id IN (${ids})`);
    await q(`DELETE FROM chain_txs WHERE invoice_id IN (${ids})`);
    await q('DELETE FROM invoices WHERE ref LIKE $1', [`${run}-%`]);
  }
  await closeDb();
});

test('an order is priced 2% above the rate', { skip }, async () => {
  const i = await mk(50); // 50,000 satoshi at the rate, 51,000 with the margin
  assert.equal(i.usd, 50);
  assert.equal(i.amount_atomic, '51000');
  assert.equal(i.amount, '0.00051000');
});

test('the margin can be changed or switched off, and a bad value gives the default', { skip }, async () => {
  try {
    process.env.INVOICE_BUFFER_PERCENT = '0';
    assert.equal((await mk(50)).amount_atomic, '50000');
    process.env.INVOICE_BUFFER_PERCENT = '5';
    assert.equal((await mk(50)).amount_atomic, '52500');
    process.env.INVOICE_BUFFER_PERCENT = 'abc';
    assert.equal((await mk(50)).amount_atomic, '51000');
    process.env.INVOICE_BUFFER_PERCENT = '99';
    assert.equal((await mk(50)).amount_atomic, '51000');
  } finally {
    process.env.INVOICE_BUFFER_PERCENT = '2';
  }
});

test('paying the bare price is short, paying the invoice amount settles it', { skip }, async () => {
  const i = await mk(50);
  const short = await observe(i.id, [pay('short', 50000)]);
  assert.equal(short.status, 'partial');
  assert.equal(short.queued, null);
  const full = await observe(i.id, [pay('short', 50000), pay('rest', 1000)]);
  assert.equal(full.status, 'paid');
  assert.equal(full.queued, 'finished');
});

test('an invoice expires after ten minutes by default and INVOICE_TTL_MINUTES changes it', { skip }, async () => {
  const left = async (inv) => new Date(inv.expires_at).getTime() - Date.now();
  const a = await left(await mk());
  assert.ok(a > 9 * 60_000 && a <= 10 * 60_000 + 5000, `expected about 10 minutes, got ${a} ms`);
  process.env.INVOICE_TTL_MINUTES = '3';
  try {
    const b = await left(await mk());
    assert.ok(b > 2 * 60_000 && b <= 3 * 60_000 + 5000, `expected about 3 minutes, got ${b} ms`);
  } finally {
    delete process.env.INVOICE_TTL_MINUTES;
  }
});
