// Settlement core tests against a real Postgres (skipped without DATABASE_URL). No network: chain data is passed in.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { q, closeDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { createInvoice } from '../src/invoices.js';
import { observe, openInvoices } from '../src/settle.js';

const ZPUB = 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
process.env.BTC_XPUB = ZPUB;
process.env.RATE_SOURCE = 'static';
process.env.RATE_BTC_USD = '100000';

const skip = process.env.DATABASE_URL ? false : 'DATABASE_URL not set';
const run = `test-settle-${Math.random().toString(36).slice(2, 8)}`;
let n = 0;

const txid = (s) => createHash('sha256').update(`${run}-${s}`).digest('hex');
const pay = (name, amount, confirmations, vout = 0) => ({
  txid: txid(name),
  vout,
  amount: String(amount),
  confirmations,
  height: confirmations ? 800000 : null,
});
// $50 at the fixed rate of $100,000 per BTC is exactly 50,000 satoshi.
const mk = async () => (await createInvoice({ ref: `${run}-${n++}`, usd: 50 })).invoice;
const row = async (id) => (await q('SELECT * FROM invoices WHERE id = $1', [id])).rows[0];
const outbox = async (id) => (await q('SELECT event, payload FROM webhook_outbox WHERE invoice_id = $1 ORDER BY id', [id])).rows;
const audits = async (id, action) =>
  (await q('SELECT count(*)::int AS n FROM audit_log WHERE subject = $1 AND action = $2', [id, action])).rows[0].n;
const future = (inv, hours) => new Date(new Date(inv.expires_at).getTime() + hours * 3_600_000);

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

test('a payment with no confirmations shows as confirming and queues nothing', { skip }, async () => {
  const inv = await mk();
  const r = await observe(inv.id, [pay('a', 50000, 0)]);
  assert.equal(r.status, 'confirming');
  assert.equal((await row(inv.id)).received_atomic, '0');
  assert.equal((await outbox(inv.id)).length, 0);
});

test('a confirmed full payment marks the invoice paid and queues one finished callback', { skip }, async () => {
  const inv = await mk();
  const r = await observe(inv.id, [pay('b', 50000, 1)]);
  assert.equal(r.status, 'paid');
  assert.equal(r.queued, 'finished');
  const i = await row(inv.id);
  assert.equal(i.status, 'paid');
  assert.ok(i.paid_at);
  const o = await outbox(inv.id);
  assert.equal(o.length, 1);
  assert.equal(o[0].event, 'finished');
  assert.deepEqual(o[0].payload, {
    order_id: inv.ref,
    payment_id: inv.id,
    payment_status: 'finished',
    price_amount: 50,
    price_currency: 'usd',
    pay_currency: 'btc',
    network: 'btc',
    pay_amount: '0.00050000',
    actually_paid: '0.00050000',
  });
});

test('observing the same data again changes nothing', { skip }, async () => {
  const inv = await mk();
  const data = [pay('c', 50000, 1)];
  await observe(inv.id, data);
  const again = await observe(inv.id, data);
  assert.equal(again.queued, null);
  assert.equal((await outbox(inv.id)).length, 1);
  assert.equal(await audits(inv.id, 'invoice.status'), 1);
  assert.equal((await q('SELECT count(*)::int AS n FROM chain_txs WHERE invoice_id = $1', [inv.id])).rows[0].n, 1);
});

test('an unconfirmed payment later confirms and is counted once', { skip }, async () => {
  const inv = await mk();
  await observe(inv.id, [pay('d', 50000, 0)]);
  const r = await observe(inv.id, [pay('d', 50000, 1)]);
  assert.equal(r.status, 'paid');
  assert.equal((await q('SELECT count(*)::int AS n FROM chain_txs WHERE invoice_id = $1', [inv.id])).rows[0].n, 1);
});

test('overpaying is accepted and recorded', { skip }, async () => {
  const inv = await mk();
  const r = await observe(inv.id, [pay('e', 70000, 1)]);
  assert.equal(r.status, 'paid');
  assert.equal((await row(inv.id)).received_atomic, '70000');
  assert.equal((await outbox(inv.id))[0].payload.actually_paid, '0.00070000');
});

test('a short payment waits; a second payment completes it', { skip }, async () => {
  const inv = await mk();
  const a = await observe(inv.id, [pay('f', 30000, 1)]);
  assert.equal(a.status, 'partial');
  assert.equal((await row(inv.id)).received_atomic, '30000');
  assert.equal((await outbox(inv.id)).length, 0);
  const b = await observe(inv.id, [pay('f', 30000, 1), pay('g', 20000, 3)]);
  assert.equal(b.status, 'paid');
  assert.equal((await outbox(inv.id)).length, 1);
});

test('two outputs of one transaction both count', { skip }, async () => {
  const inv = await mk();
  const r = await observe(inv.id, [pay('h', 25000, 1, 0), pay('h', 25000, 1, 1)]);
  assert.equal(r.status, 'paid');
});

test('the confirmation setting is respected', { skip }, async () => {
  process.env.BTC_CONFIRMATIONS = '2';
  try {
    const inv = await mk();
    assert.equal((await observe(inv.id, [pay('i', 50000, 1)])).status, 'confirming');
    assert.equal((await observe(inv.id, [pay('i', 50000, 2)])).status, 'paid');
  } finally {
    delete process.env.BTC_CONFIRMATIONS;
  }
});

test('an unconfirmed payment that disappears from the chain is dropped', { skip }, async () => {
  const inv = await mk();
  assert.equal((await observe(inv.id, [pay('j', 50000, 0)])).status, 'confirming');
  assert.equal((await observe(inv.id, [])).status, 'pending');
  assert.equal((await q('SELECT count(*)::int AS n FROM chain_txs WHERE invoice_id = $1', [inv.id])).rows[0].n, 0);
});

test('an expired invoice with no money is closed as expired', { skip }, async () => {
  const inv = await mk();
  assert.equal((await observe(inv.id, [], future(inv, -1))).status, 'pending');
  const r = await observe(inv.id, [], future(inv, 1));
  assert.equal(r.status, 'expired');
  assert.equal(r.queued, 'expired');
  const again = await observe(inv.id, [], future(inv, 2));
  assert.equal(again.queued, null);
  const o = await outbox(inv.id);
  assert.equal(o.length, 1);
  assert.equal(o[0].payload.payment_status, 'expired');
});

test('an expired invoice with some money is closed as partially paid', { skip }, async () => {
  const inv = await mk();
  const r = await observe(inv.id, [pay('k', 20000, 1)], future(inv, 1));
  assert.equal(r.status, 'partial');
  assert.equal(r.queued, 'partially_paid');
  assert.equal((await outbox(inv.id))[0].payload.actually_paid, '0.00020000');
});

test('money that arrives after the outcome is recorded and audited, but changes no outcome', { skip }, async () => {
  const inv = await mk();
  await observe(inv.id, [pay('l', 20000, 1)], future(inv, 1));
  const r = await observe(inv.id, [pay('l', 20000, 1), pay('m', 30000, 1)], future(inv, 2));
  assert.equal(r.status, 'partial');
  assert.equal(r.queued, null);
  assert.equal((await row(inv.id)).received_atomic, '50000');
  assert.equal((await outbox(inv.id)).length, 1);
  assert.equal(await audits(inv.id, 'payment.late'), 1);
});

test('a payment unconfirmed at expiry is waited for, up to 24 hours', { skip }, async () => {
  const a = await mk();
  assert.equal((await observe(a.id, [pay('n', 50000, 0)], future(a, 1))).status, 'confirming');
  assert.equal((await observe(a.id, [pay('n', 50000, 1)], future(a, 2))).status, 'paid');
  const b = await mk();
  assert.equal((await observe(b.id, [pay('o', 50000, 0)], future(b, 23))).status, 'confirming');
  assert.equal((await observe(b.id, [pay('o', 50000, 0)], future(b, 25))).status, 'expired');
});

test('ten parallel observations queue one callback', { skip }, async () => {
  const inv = await mk();
  const all = await Promise.all(Array.from({ length: 10 }, () => observe(inv.id, [pay('p', 50000, 1)])));
  assert.equal(all.filter((x) => x.queued).length, 1);
  assert.equal((await outbox(inv.id)).length, 1);
  assert.equal(await audits(inv.id, 'invoice.status'), 1);
});

test('open invoices lists unfinished orders only', { skip }, async () => {
  const open = await mk();
  const paid = await mk();
  const closed = await mk();
  await observe(paid.id, [pay('q', 50000, 1)]);
  await observe(closed.id, [], future(closed, 1));
  const ids = (await openInvoices()).map((x) => x.id);
  assert.ok(ids.includes(open.id));
  assert.ok(!ids.includes(paid.id));
  assert.ok(!ids.includes(closed.id));
});

test('bad chain data is refused and unknown invoices fail', { skip }, async () => {
  const inv = await mk();
  const bad = [
    { ...pay('r', 0, 1) },
    { ...pay('r', -5, 1) },
    { ...pay('r', 'abc', 1) },
    { ...pay('r', 5, -1) },
    { ...pay('r', 5, 1.5) },
    { ...pay('r', 5, 1), txid: 'zz' },
    { ...pay('r', 5, 1), vout: -1 },
  ];
  for (const b of bad) await assert.rejects(() => observe(inv.id, [b]), /Invalid chain payment data/, JSON.stringify(b));
  await assert.rejects(() => observe('inv_nope', []), /Unknown invoice/);
  assert.equal((await q('SELECT count(*)::int AS n FROM chain_txs WHERE invoice_id = $1', [inv.id])).rows[0].n, 0);
});
