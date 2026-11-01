// Admin overview tests. The auth test needs no database; the overview test uses a real Postgres (skipped without DATABASE_URL).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { q, closeDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { adminOverview, handleUnmatched, gapCount } from '../src/admin-api.js';
import { recordUnmatched } from '../src/settle.js';
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
    ['btc', 'eth', 'bsc', 'pol', 'trx', 'sol', 'ton'],
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
  assert.equal(typeof o.callbacks.parked, 'number');
  assert.ok(Array.isArray(o.audit));
  assert.ok(Array.isArray(o.alerts));
  assert.ok(o.btcGap === null || typeof o.btcGap.gap === 'number');
});

test('the BTC address gap counts the unused addresses handed out after the last one that got money', () => {
  assert.equal(gapCount(null, null), 0);
  assert.equal(gapCount(0, null), 0);
  assert.equal(gapCount(3, null), 3);
  assert.equal(gapCount('8', '5'), 2);
  assert.equal(gapCount(6, 5), 0);
  assert.equal(gapCount(5, 9), 0);
});

test('a short API secret is refused even when the caller sends the same one', async () => {
  const s = await serve();
  const saved = process.env.GATEWAY_API_SECRET;
  process.env.GATEWAY_API_SECRET = 'short-secret';
  try {
    const r = await fetch(`http://127.0.0.1:${s.address().port}/v1/admin/overview`, { headers: { authorization: 'Bearer short-secret' } });
    assert.equal(r.status, 503);
  } finally {
    process.env.GATEWAY_API_SECRET = saved;
    s.close();
  }
});

test('the retry route needs the Bearer secret', async () => {
  const s = await serve();
  try {
    const url = `http://127.0.0.1:${s.address().port}/v1/admin/callbacks/retry`;
    assert.equal((await fetch(url, { method: 'POST' })).status, 401);
    assert.equal((await fetch(url, { method: 'POST', headers: { authorization: 'Bearer wrong-secret-0123456789' } })).status, 401);
  } finally {
    s.close();
  }
});

test('the overview lists late payments and gave-up callbacks of the last 30 days for a person to look at', { skip }, async () => {
  const real = `inv_${run}r`;
  const gone = `inv_${run}x`;
  const idx = 9_000_000_000 + Math.floor(Math.random() * 1_000_000);
  const t1 = randomBytes(32).toString('hex');
  const t2 = randomBytes(32).toString('hex');
  const audit = (action, subject, detail) => q('INSERT INTO audit_log (actor, action, subject, detail) VALUES (\'watcher\', $1, $2, $3::jsonb)', [action, subject, JSON.stringify(detail)]);
  try {
    // A paid invoice is not watched, so no other test sees this row.
    await q(
      `INSERT INTO invoices (id, ref, kind, network, asset, address, deriv_index, usd, expected_atomic, status, expires_at, match_amount)
       VALUES ($1, $2, 'order', 'btc', 'btc', $3, $4, 50, 50000, 'paid', now(), true)`,
      [real, `${run}-late`, `bc1q${run}late`, idx],
    );
    await audit('payment.late', real, { txid: t1, vout: 0, amount: '12345', status: 'expired' });
    await audit('payment.late', gone, { txid: t2, vout: 0, amount: '777', status: 'expired' });
    await audit('webhook.gave_up', gone, { outbox: 1, event: 'finished', attempts: 24, error: 'app answered HTTP 503' });
    const o = await adminOverview();
    assert.ok(o.alerts.length <= 20);
    const a = o.alerts.find((x) => x.txid === t1);
    assert.equal(a.action, 'payment.late');
    assert.equal(a.ref, `${run}-late`);
    assert.equal(a.network, 'btc');
    assert.equal(a.amount, '0.00012345');
    const b = o.alerts.find((x) => x.txid === t2);
    assert.equal(b.subject, gone);
    assert.equal(b.amount, null, 'no invoice row, so there is no coin to show it in');
    const g = o.alerts.find((x) => x.action === 'webhook.gave_up' && x.subject === gone);
    assert.equal(g.event, 'finished');
    assert.equal(g.error, 'app answered HTTP 503');
  } finally {
    await q('DELETE FROM invoices WHERE id = $1', [real]);
  }
});

test('the handle route needs the Bearer secret', async () => {
  const s = await serve();
  try {
    const url = `http://127.0.0.1:${s.address().port}/v1/admin/unmatched/handle`;
    const body = JSON.stringify({ network: 'btc', txid: 'a'.repeat(64), vout: 0 });
    assert.equal((await fetch(url, { method: 'POST', body })).status, 401);
    assert.equal((await fetch(url, { method: 'POST', body, headers: { authorization: 'Bearer wrong-secret-0123456789' } })).status, 401);
  } finally {
    s.close();
  }
});

test('Handled hides an unmatched payment, audits it once and the scanner seeing it again does not bring it back', { skip }, async () => {
  const addr = `bc1q${run}h`;
  const txid = randomBytes(32).toString('hex');
  const txid2 = randomBytes(32).toString('hex');
  const insert = (id) =>
    q("INSERT INTO unmatched_txs (network, asset, address, txid, vout, amount_atomic, confirmations) VALUES ('btc', 'btc', $1, $2, 0, 50777, 1)", [addr, id]);
  const shown = async (id) => (await adminOverview()).unmatched.recent.some((x) => x.txid === id);
  const audits = async (id) => (await q("SELECT detail FROM audit_log WHERE action = 'unmatched.handled' AND subject = $1", [`btc:${id}`])).rows;
  const s = await serve();
  try {
    await insert(txid);
    await insert(txid2);
    assert.ok(await shown(txid));
    const before = (await adminOverview()).unmatched.total;

    assert.deepEqual(await handleUnmatched({ network: 'btc', txid, vout: 0, note: '  sent back  ' }), { handled: true, already: false });
    assert.equal(await shown(txid), false);
    assert.equal((await adminOverview()).unmatched.total, before - 1);
    let a = await audits(txid);
    assert.equal(a.length, 1);
    assert.equal(a[0].detail.note, 'sent back');

    // Repeating changes nothing and writes no second audit row.
    assert.deepEqual(await handleUnmatched({ network: 'btc', txid, vout: 0, note: 'again' }), { handled: true, already: true });
    assert.equal((await audits(txid)).length, 1);

    // The scanner sees the payment again: it stays handled and is not counted as new.
    const added = await recordUnmatched({
      network: 'btc',
      address: addr,
      defaultAsset: 'btc',
      payments: [{ txid, vout: 0, amount: '50777', confirmations: 2, height: 10 }],
      claimed: new Set(),
    });
    assert.equal(added, 0);
    const row = (await q('SELECT handled_at, handled_note, confirmations FROM unmatched_txs WHERE txid = $1', [txid])).rows[0];
    assert.ok(row.handled_at);
    assert.equal(row.handled_note, 'sent back');
    assert.equal(row.confirmations, 2);
    assert.equal(await shown(txid), false);

    // Bad input is 400, an unknown payment is 404.
    await assert.rejects(handleUnmatched({ network: 'nope', txid, vout: 0 }), (e) => e.status === 400);
    await assert.rejects(handleUnmatched({ network: 'btc', txid, vout: -1 }), (e) => e.status === 400);
    await assert.rejects(handleUnmatched({ network: 'btc', txid: randomBytes(32).toString('hex'), vout: 0 }), (e) => e.status === 404);

    // Over HTTP with the secret.
    const url = `http://127.0.0.1:${s.address().port}/v1/admin/unmatched/handle`;
    const headers = { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' };
    const ok = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ network: 'btc', txid: txid2, vout: 0, note: 'x' }) });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true, handled: true, already: false });
    assert.equal(await shown(txid2), false);
    const gone = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ network: 'btc', txid: randomBytes(32).toString('hex'), vout: 0 }) });
    assert.equal(gone.status, 404);
  } finally {
    s.close();
    await q('DELETE FROM unmatched_txs WHERE address = $1', [addr]);
  }
});
