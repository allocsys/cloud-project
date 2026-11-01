// Watcher tests against a real Postgres (skipped without DATABASE_URL). The explorer is a fake: no network.
// The fake THROWS for addresses it does not know, so invoices from other test files sharing this database are left untouched (fail closed).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { q, closeDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { createInvoice } from '../src/invoices.js';
import { pollOnce, startWatcher, sweepEnded } from '../src/watcher.js';

const ZPUB = 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
process.env.BTC_XPUB = ZPUB;
process.env.RATE_SOURCE = 'static';
process.env.RATE_BTC_USD = '100000';

const skip = process.env.DATABASE_URL ? false : 'DATABASE_URL not set';
const run = `test-watch-${Math.random().toString(36).slice(2, 8)}`;
let n = 0;
const quiet = { error() {}, info() {} };

const txid = (s) => createHash('sha256').update(`${run}-${s}`).digest('hex');
const pay = (name, amount, confirmations) => ({ txid: txid(name), vout: 0, amount: String(amount), confirmations, height: confirmations ? 800000 : null });
const mk = async () => (await createInvoice({ ref: `${run}-${n++}`, usd: 50 })).invoice; // 50,000 satoshi
const fake = (map, calls = { n: 0 }) => ({
  addressPayments: async (address) => {
    calls.n++;
    const v = map[address];
    if (v === undefined) throw new Error('unknown address');
    if (v instanceof Error) throw v;
    return v;
  },
});
const row = async (id) => (await q('SELECT * FROM invoices WHERE id = $1', [id])).rows[0];
const outbox = async (id) => (await q('SELECT event FROM webhook_outbox WHERE invoice_id = $1', [id])).rows;
const txCount = async (id) => (await q('SELECT count(*)::int AS n FROM chain_txs WHERE invoice_id = $1', [id])).rows[0].n;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  if (!skip) await migrate();
});

after(async () => {
  if (!skip) {
    const ids = `SELECT id FROM invoices WHERE ref LIKE '${run}-%'`;
    await q(`DELETE FROM webhook_outbox WHERE invoice_id IN (${ids})`);
    await q(`DELETE FROM chain_txs WHERE invoice_id IN (${ids})`);
    await q(`DELETE FROM unmatched_txs WHERE address IN (SELECT address FROM invoices WHERE ref LIKE '${run}-%')`);
    await q('DELETE FROM invoices WHERE ref LIKE $1', [`${run}-%`]);
  }
  await closeDb();
});

test('a poll settles an invoice the chain shows as paid', { skip }, async () => {
  const inv = await mk();
  const r = await pollOnce({ explorers: { btc: fake({ [inv.address]: [pay('a', 50000, 1)] }) }, log: quiet });
  assert.ok(r.settled.some((s) => s.id === inv.id && s.queued === 'finished'));
  assert.equal((await row(inv.id)).status, 'paid');
  assert.equal((await outbox(inv.id)).length, 1);
});

test('a failed lookup changes nothing for that invoice', { skip }, async () => {
  const inv = await mk();
  await pollOnce({ explorers: { btc: fake({ [inv.address]: [pay('b', 50000, 0)] }) }, log: quiet });
  assert.equal((await row(inv.id)).status, 'confirming');
  assert.equal(await txCount(inv.id), 1);
  const r = await pollOnce({ explorers: { btc: fake({ [inv.address]: new Error('explorer down') }) }, log: quiet });
  assert.ok(r.failures.some((f) => f.id === inv.id && f.error === 'explorer down'));
  assert.equal((await row(inv.id)).status, 'confirming');
  assert.equal(await txCount(inv.id), 1);
});

test('one failing invoice does not stop the others', { skip }, async () => {
  const bad = await mk();
  const good = await mk();
  const map = { [bad.address]: new Error('boom'), [good.address]: [pay('c', 50000, 1)] };
  await pollOnce({ explorers: { btc: fake(map) }, log: quiet });
  assert.equal((await row(bad.id)).status, 'pending');
  assert.equal((await row(good.id)).status, 'paid');
});

test('an invoice on a network without an explorer is skipped', { skip }, async () => {
  const inv = await mk();
  const r = await pollOnce({ explorers: {}, log: quiet });
  assert.ok(!r.failures.some((f) => f.id === inv.id));
  assert.equal((await row(inv.id)).status, 'pending');
});

test('money that comes after an invoice ended is kept aside for a person', { skip }, async () => {
  const inv = await mk();
  const gone = new Date((await row(inv.id)).expires_at.getTime() + 60_000);
  await pollOnce({ explorers: { btc: fake({ [inv.address]: [] }) }, now: gone, log: quiet });
  assert.equal((await row(inv.id)).status, 'expired');
  assert.equal((await outbox(inv.id)).length, 1);
  const late = pay('late', 50000, 1);
  const explorers = { btc: fake({ [inv.address]: [late] }) };
  const looked = new Map();
  const r = await sweepEnded({ explorers, now: gone, log: quiet, cap: 500, looked });
  assert.ok(r.looked >= 1 && r.recorded >= 1);
  const kept = (await q('SELECT address, amount_atomic::text AS amount FROM unmatched_txs WHERE txid = $1', [late.txid])).rows;
  assert.equal(kept.length, 1);
  assert.equal(kept[0].address, inv.address);
  assert.equal(kept[0].amount, '50000');
  const audit = (await q("SELECT detail FROM audit_log WHERE action = 'payment.unmatched' AND subject = $1", [`btc:${late.txid}`])).rows;
  assert.equal(audit.length, 1);
  assert.equal(audit[0].detail.invoice, inv.id);
  // the order's own outcome does not change
  assert.equal((await row(inv.id)).status, 'expired');
  assert.equal((await outbox(inv.id)).length, 1);
  // not looked at again within 5 minutes; looked at again after that, and the payment is not audited twice
  const first = looked.get(inv.id);
  await sweepEnded({ explorers, now: new Date(gone.getTime() + 60_000), log: quiet, cap: 500, looked });
  assert.equal(looked.get(inv.id), first);
  const later = new Date(gone.getTime() + 6 * 60_000);
  await sweepEnded({ explorers, now: later, log: quiet, cap: 500, looked });
  assert.equal(looked.get(inv.id), later.getTime());
  assert.equal((await q('SELECT count(*)::int AS n FROM audit_log WHERE subject = $1 AND action = $2', [`btc:${late.txid}`, 'payment.unmatched'])).rows[0].n, 1);
});

test('a failed look at an ended invoice is logged and never raises', { skip }, async () => {
  const inv = await mk();
  const gone = new Date((await row(inv.id)).expires_at.getTime() + 60_000);
  await pollOnce({ explorers: { btc: fake({ [inv.address]: [] }) }, now: gone, log: quiet });
  const r = await sweepEnded({ explorers: { btc: fake({ [inv.address]: new Error('explorer down') }) }, now: gone, log: quiet, cap: 500, looked: new Map() });
  assert.ok(r.failures >= 1);
  assert.equal((await row(inv.id)).status, 'expired');
});

test('the loop settles invoices on its own and stops cleanly', { skip }, async () => {
  const inv = await mk();
  const calls = { n: 0 };
  const stop = startWatcher({ explorers: { btc: fake({ [inv.address]: [pay('d', 50000, 1)] }, calls) }, intervalMs: 20, log: quiet });
  const until = Date.now() + 4000;
  while (Date.now() < until && (await row(inv.id)).status !== 'paid') await sleep(25);
  await stop();
  assert.equal((await row(inv.id)).status, 'paid');
  assert.equal((await outbox(inv.id)).length, 1);
  const after = calls.n;
  await sleep(150);
  assert.equal(calls.n, after, 'no more lookups after stop()');
});
