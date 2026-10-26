// Network pause tests. Input checks need no database; the rest use a real Postgres (skipped without DATABASE_URL).
// Only 'sol' is ever really paused here: other test files share this database and run at the same time, and none of them uses sol.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { q, closeDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { createInvoice } from '../src/invoices.js';
import { adminOverview, setNetworkPaused } from '../src/admin-api.js';
import { pausedNetworks, isPaused, hasOpenInvoices } from '../src/pause.js';
import { startScanner } from '../src/evm-scanner.js';

const ZPUB = 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
process.env.BTC_XPUB = ZPUB;
process.env.RATE_SOURCE = 'static';
process.env.RATE_BTC_USD = '100000';

const skip = process.env.DATABASE_URL ? false : 'DATABASE_URL not set';
const run = `test-pause-${Math.random().toString(36).slice(2, 8)}`;

before(async () => {
  if (!skip) await migrate();
});

after(async () => {
  if (!skip) {
    await q('DELETE FROM invoices WHERE ref LIKE $1', [`${run}-%`]);
    await q("DELETE FROM paused_networks WHERE network = 'sol'");
    await q("DELETE FROM chain_cursors WHERE network = 'sol'");
  }
  await closeDb();
});

test('pausing needs a known network and a true or false', async () => {
  await assert.rejects(setNetworkPaused({ network: 'nope', paused: true }), (e) => e.status === 400);
  await assert.rejects(setNetworkPaused({ network: 'sol', paused: 'yes' }), (e) => e.status === 400);
  await assert.rejects(setNetworkPaused({}), (e) => e.status === 400);
});

test('pause and resume: the flag, the overview, the audit log and the scanner cursor', { skip }, async () => {
  await q("INSERT INTO chain_cursors (network, height, hash, tip) VALUES ('sol', 5, $1, 5) ON CONFLICT (network) DO NOTHING", [`0x${'b'.repeat(64)}`]);
  try {
    assert.deepEqual(await setNetworkPaused({ network: 'sol', paused: true }), { paused: true, already: false });
    assert.deepEqual(await setNetworkPaused({ network: 'sol', paused: true }), { paused: true, already: true });
    assert.equal(await isPaused('sol'), true);
    assert.ok((await pausedNetworks()).has('sol'));
    const o = await adminOverview();
    const sol = o.networks.find((n) => n.network === 'sol');
    assert.equal(sol.paused, true);
    assert.equal(sol.open, 0);
    assert.equal(o.networks.find((n) => n.network === 'btc').paused, false);
    const audited = (await q("SELECT count(*)::int AS n FROM audit_log WHERE action = 'network.pause' AND subject = 'sol'")).rows[0].n;
    assert.ok(audited >= 1);

    assert.deepEqual(await setNetworkPaused({ network: 'sol', paused: false }), { paused: false, already: false });
    assert.equal(await isPaused('sol'), false);
    assert.equal((await q("SELECT 1 FROM chain_cursors WHERE network = 'sol'")).rows.length, 1, 'resuming leaves the cursor; the scanner wake logic bounds the catch-up');
    assert.deepEqual(await setNetworkPaused({ network: 'sol', paused: false }), { paused: false, already: true });
  } finally {
    await q("DELETE FROM paused_networks WHERE network = 'sol'");
    await q("DELETE FROM chain_cursors WHERE network = 'sol'");
  }
});

test('a network with open invoices cannot be paused', { skip }, async () => {
  const inv = (await createInvoice({ ref: `${run}-0`, usd: 50 })).invoice;
  assert.equal(inv.status, 'pending');
  await assert.rejects(setNetworkPaused({ network: 'btc', paused: true }), (e) => e.status === 409);
  assert.equal(await isPaused('btc'), false);
  assert.ok((await adminOverview()).networks.find((n) => n.network === 'btc').open >= 1);
  assert.equal(await hasOpenInvoices('btc'), true);
});

test('an idle scanner makes no node calls, wakes when an invoice opens and sleeps again when it closes', { skip }, async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const calls = { wake: 0, scan: 0 };
  const fake = {
    network: 'sol',
    wake: async () => {
      calls.wake++;
      return { kept: true };
    },
    scanOnce: async () => {
      calls.scan++;
      return { scanned: 0, found: 0, more: false };
    },
  };
  const quiet = { error() {}, info() {} };
  const stop = startScanner(fake, { intervalMs: 20, log: quiet });
  try {
    await sleep(200);
    assert.deepEqual(calls, { wake: 0, scan: 0 }, 'no open invoice: no calls');
    assert.equal(await hasOpenInvoices('sol'), false);

    await q(
      "INSERT INTO invoices (id, ref, network, asset, address, deriv_index, expires_at, status) VALUES ($1, $2, 'sol', 'sol', $3, 0, now() + interval '10 minutes', 'pending')",
      [`inv_${run}`, `${run}-sol`, `sol${run}`],
    );
    assert.equal(await hasOpenInvoices('sol'), true);
    const until = Date.now() + 3000;
    while (Date.now() < until && calls.scan < 2) await sleep(20);
    assert.equal(calls.wake, 1, 'woken once');
    assert.ok(calls.scan >= 2, 'scanning while the invoice is open');

    await q("UPDATE invoices SET status = 'expired' WHERE id = $1", [`inv_${run}`]);
    await sleep(100);
    const seen = calls.scan;
    await sleep(200);
    assert.equal(calls.scan, seen, 'asleep again once nothing is open');
  } finally {
    await stop();
  }
});
