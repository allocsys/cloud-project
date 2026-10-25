// Fixed-address mode against a real Postgres (skipped without DATABASE_URL). No network: chain data is passed in.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { q, closeDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { createInvoice } from '../src/invoices.js';
import { observe } from '../src/settle.js';
import { pollOnce } from '../src/watcher.js';

const skip = process.env.DATABASE_URL ? false : 'DATABASE_URL not set';
const run = `test-shared-${Math.random().toString(36).slice(2, 8)}`;
const ADDR = `bc1qtest${run.replace(/-/g, '')}`;
delete process.env.BTC_XPUB;
process.env.PAY_ADDR_BTC = ADDR;
process.env.RATE_SOURCE = 'static';
process.env.RATE_BTC_USD = '100000';

const quiet = { error() {}, info() {} };
const ids = [];
let n = 0;
const txid = (s) => {
  const t = createHash('sha256').update(`${run}-${s}`).digest('hex');
  ids.push(t);
  return t;
};
const pay = (name, amount, confirmations = 1) => ({ txid: txid(name), vout: 0, amount: String(amount), confirmations, height: 800000 });
const mk = async (usd = 50) => (await createInvoice({ ref: `${run}-${n++}`, usd })).invoice;
const row = async (id) => (await q('SELECT * FROM invoices WHERE id = $1', [id])).rows[0];
const fake = (map) => ({
  addressPayments: async (address) => {
    const v = map[address];
    if (v === undefined) throw new Error('unknown address');
    return v;
  },
});

before(async () => {
  if (!skip) await migrate();
});

after(async () => {
  if (!skip) {
    const inv = `SELECT id FROM invoices WHERE ref LIKE '${run}-%'`;
    await q(`DELETE FROM webhook_outbox WHERE invoice_id IN (${inv})`);
    await q(`DELETE FROM chain_txs WHERE invoice_id IN (${inv})`);
    await q('DELETE FROM unmatched_txs WHERE address = $1', [ADDR]);
    await q('DELETE FROM invoices WHERE ref LIKE $1', [`${run}-%`]);
  }
  await closeDb();
});

test('invoices share the fixed address and get different exact amounts', { skip }, async () => {
  const a = await mk();
  const b = await mk();
  assert.equal(a.address, ADDR);
  assert.equal(b.address, ADDR);
  assert.equal(a.amount, '0.00050000'); // $50 at $100,000 per BTC
  assert.notEqual(a.amount_atomic, b.amount_atomic);
  assert.ok(BigInt(b.amount_atomic) > BigInt(a.amount_atomic));
  assert.equal((await row(a.id)).match_amount, true);
});

test('asking again with the same ref returns the same invoice and amount', { skip }, async () => {
  const ref = `${run}-same`;
  const a = await createInvoice({ ref, usd: 50 });
  const b = await createInvoice({ ref, usd: 50 });
  assert.equal(a.created, true);
  assert.equal(b.created, false);
  assert.equal(a.invoice.amount_atomic, b.invoice.amount_atomic);
});

test('only the exact amount settles an invoice', { skip }, async () => {
  const a = await mk();
  const b = await mk();
  const seen = [pay('exact', b.amount_atomic)];
  assert.equal((await observe(a.id, seen)).status, 'pending');
  const r = await observe(b.id, seen);
  assert.equal(r.status, 'paid');
  assert.equal(r.queued, 'finished');
});

test('a poll settles by exact amount and keeps other payments aside', { skip }, async () => {
  const a = await mk();
  const b = await mk();
  const odd = pay('odd', 12345);
  const r = await pollOnce({ explorers: { btc: fake({ [ADDR]: [pay('poll', a.amount_atomic), odd] }) }, log: quiet });
  assert.ok(r.settled.some((s) => s.id === a.id && s.queued === 'finished'));
  assert.equal((await row(a.id)).status, 'paid');
  assert.equal((await row(b.id)).status, 'pending');
  const kept = (await q('SELECT * FROM unmatched_txs WHERE txid = $1', [odd.txid])).rows;
  assert.equal(kept.length, 1);
  assert.equal(kept[0].amount_atomic, '12345');
  assert.equal(kept[0].asset, 'btc');
  // asking again changes nothing and does not audit twice
  await pollOnce({ explorers: { btc: fake({ [ADDR]: [odd] }) }, log: quiet });
  assert.equal((await q('SELECT count(*)::int AS n FROM audit_log WHERE subject = $1 AND action = $2', [`btc:${odd.txid}`, 'payment.unmatched'])).rows[0].n, 1);
});

test('old history of the address is not recorded as unmatched', { skip }, async () => {
  await mk();
  const old = pay('old', 777, 5000);
  await pollOnce({ explorers: { btc: fake({ [ADDR]: [old] }) }, log: quiet });
  assert.equal((await q('SELECT count(*)::int AS n FROM unmatched_txs WHERE txid = $1', [old.txid])).rows[0].n, 0);
});

test('a fixed-address invoice needs an amount', { skip }, async () => {
  await assert.rejects(
    () => createInvoice({ ref: `${run}-dep`, kind: 'deposit', user_ref: 'u1', network: 'btc', asset: 'btc' }),
    /usd is required/,
  );
});
