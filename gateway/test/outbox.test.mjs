// Outbox sender tests. Signing and target checks need no database; delivery tests use a real Postgres (skipped without DATABASE_URL).
// The fake fetch only answers for rows made by THIS file and fails for any other row, so rows from other test files sharing the
// database are left alone (they just get a failed attempt recorded, which their tests do not look at).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { q, closeDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { createInvoice } from '../src/invoices.js';
import { signBody, backoffSeconds, webhookTarget, deliverDue, MAX_ATTEMPTS } from '../src/outbox.js';

const ZPUB = 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
process.env.BTC_XPUB = ZPUB;
process.env.RATE_SOURCE = 'static';
process.env.RATE_BTC_USD = '100000';

const SECRET = 'whsec_test_secret_0123456789';
const target = { url: 'https://app.example/api/payments/webhook', secret: SECRET };
const skip = process.env.DATABASE_URL ? false : 'DATABASE_URL not set';
const run = `test-outbox-${Math.random().toString(36).slice(2, 8)}`;
let n = 0;
const quiet = { error() {}, info() {} };

// An independent copy of the app's verifier logic (the gateway must not import the app): recursive key sort, hex HMAC-SHA512.
const sortDeep = (v) => (Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])])) : v);
const appVerifies = (raw, sig, secret = SECRET) => createHmac('sha512', secret).update(JSON.stringify(sortDeep(JSON.parse(raw)))).digest('hex') === sig;

const payload = (ref, extra = {}) => ({ order_id: ref, payment_id: 'inv_x', payment_status: 'finished', price_amount: 50, price_currency: 'usd', pay_currency: 'btc', network: 'btc', pay_amount: '0.0005', actually_paid: '0.0005', ...extra });

// An invoice plus one outbox row for it. Returns { id (outbox id), ref }.
async function mk(extra) {
  const ref = `${run}-${n++}`;
  const inv = (await createInvoice({ ref, usd: 50 })).invoice;
  const p = payload(ref, extra);
  const id = (await q("INSERT INTO webhook_outbox (invoice_id, event, payload) VALUES ($1, 'finished', $2::jsonb) RETURNING id", [inv.id, JSON.stringify(p)])).rows[0].id;
  return { id: Number(id), ref, invoice: inv.id };
}
const row = async (id) => (await q('SELECT * FROM webhook_outbox WHERE id = $1', [id])).rows[0];
const mine = (init) => String(JSON.parse(init.body).order_id).startsWith(run);

// A fake app. `answer(init)` returns a status number, or throws. Only rows of this file are answered.
function fakeApp(answer = () => 200) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    if (!mine(init)) throw new Error('not a row of this test');
    calls.push({ url, init });
    const status = await answer(init, calls.length);
    return { ok: status >= 200 && status < 300, status, body: { cancel: async () => {} } };
  };
  return { fetchImpl, calls };
}

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

test('the signature is a hex HMAC-SHA512 over the key-sorted JSON, whatever the key order', () => {
  const a = { b: 1, a: { z: 2, y: [3, { q: 1, p: 2 }] } };
  const b = { a: { y: [3, { p: 2, q: 1 }], z: 2 }, b: 1 };
  assert.match(signBody(a, SECRET), /^[0-9a-f]{128}$/);
  assert.equal(signBody(a, SECRET), signBody(b, SECRET));
  assert.notEqual(signBody(a, SECRET), signBody(a, `${SECRET}x`));
  assert.notEqual(signBody({ ...a, b: 2 }, SECRET), signBody(a, SECRET));
  const raw = JSON.stringify(b);
  assert.ok(appVerifies(raw, signBody(a, SECRET)));
});

test('backoff doubles from 30 seconds and stops at one hour', () => {
  assert.deepEqual([1, 2, 3, 4].map(backoffSeconds), [30, 60, 120, 240]);
  assert.equal(backoffSeconds(8), 3600);
  assert.equal(backoffSeconds(40), 3600);
});

test('the target must be https (localhost may use http) with a long enough secret', () => {
  const t = (url, secret) => () => webhookTarget({ appWebhookUrl: url, webhookSecret: secret });
  assert.equal(webhookTarget({ appWebhookUrl: '', webhookSecret: '' }), null);
  assert.ok(t('https://app.example/hook', SECRET)());
  assert.ok(t('http://localhost:3000/hook', SECRET)());
  assert.throws(t('http://app.example/hook', SECRET), /https/);
  assert.throws(t('ftp://app.example/hook', SECRET), /https/);
  assert.throws(t('not a url', SECRET), /valid URL/);
  assert.throws(t('https://app.example/hook', 'short'), /16 characters/);
  assert.throws(t('', SECRET), /APP_WEBHOOK_URL/);
});

test('a due callback is sent once, signed, and marked delivered', { skip }, async () => {
  const o = await mk();
  const app = fakeApp();
  const r = await deliverDue({ target, fetchImpl: app.fetchImpl, limit: 500, log: quiet });
  assert.ok(r.delivered >= 1);
  const call = app.calls.find((c) => JSON.parse(c.init.body).order_id === o.ref);
  assert.equal(call.url, target.url);
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.redirect, 'error', 'redirects are refused');
  assert.equal(call.init.headers['content-type'], 'application/json');
  assert.equal(call.init.headers['x-gateway-event'], 'finished');
  assert.equal(call.init.headers['x-gateway-delivery'], String(o.id));
  assert.ok(appVerifies(call.init.body, call.init.headers['x-gateway-sig']), 'the app can verify it');
  assert.equal(JSON.parse(call.init.body).payment_status, 'finished');
  const after1 = await row(o.id);
  assert.ok(after1.delivered_at);
  assert.equal(after1.attempts, 1);
  assert.equal(after1.last_error, null);
  const again = fakeApp();
  await deliverDue({ target, fetchImpl: again.fetchImpl, limit: 500, log: quiet });
  assert.equal(again.calls.filter((c) => JSON.parse(c.init.body).order_id === o.ref).length, 0, 'delivered rows are not sent again');
});

test('a wrong answer is recorded and retried later with a delay, not immediately', { skip }, async () => {
  const o = await mk();
  const down = fakeApp(() => 500);
  await deliverDue({ target, fetchImpl: down.fetchImpl, limit: 500, log: quiet });
  const r1 = await row(o.id);
  assert.equal(r1.delivered_at, null);
  assert.equal(r1.attempts, 1);
  assert.equal(r1.last_error, 'app answered HTTP 500');
  const wait = (new Date(r1.next_try_at) - Date.now()) / 1000;
  assert.ok(wait > 20 && wait <= 31, `next try in ${wait}s`);
  const now = fakeApp();
  await deliverDue({ target, fetchImpl: now.fetchImpl, limit: 500, log: quiet });
  assert.equal(now.calls.filter((c) => JSON.parse(c.init.body).order_id === o.ref).length, 0, 'not due yet');
  await q("UPDATE webhook_outbox SET next_try_at = now() - interval '1 second' WHERE id = $1", [o.id]);
  const up = fakeApp();
  await deliverDue({ target, fetchImpl: up.fetchImpl, limit: 500, log: quiet });
  const r2 = await row(o.id);
  assert.ok(r2.delivered_at);
  assert.equal(r2.attempts, 2);
  assert.equal(r2.last_error, null);
});

test('a network error and a timeout are failures too', { skip }, async () => {
  const a = await mk();
  const b = await mk();
  const app = fakeApp((init) => {
    if (JSON.parse(init.body).order_id === a.ref) throw new Error('connect ECONNREFUSED');
    return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  });
  await deliverDue({ target, fetchImpl: app.fetchImpl, limit: 500, timeoutMs: 50, log: quiet });
  assert.equal((await row(a.id)).last_error, 'connect ECONNREFUSED');
  assert.equal((await row(b.id)).last_error, 'timed out');
  assert.equal((await row(a.id)).delivered_at, null);
  assert.equal((await row(b.id)).delivered_at, null);
});

test('after the last allowed attempt the row is parked and audited, not dropped', { skip }, async () => {
  const o = await mk();
  await q('UPDATE webhook_outbox SET attempts = $2 WHERE id = $1', [o.id, MAX_ATTEMPTS - 1]);
  const down = fakeApp(() => 503);
  const r = await deliverDue({ target, fetchImpl: down.fetchImpl, limit: 500, log: quiet });
  assert.ok(r.parked >= 1);
  const parked = await row(o.id);
  assert.equal(parked.attempts, MAX_ATTEMPTS);
  assert.equal(parked.delivered_at, null);
  assert.equal(String(parked.next_try_at), 'Invalid Date', 'next_try_at is infinity');
  const audit = (await q("SELECT detail FROM audit_log WHERE action = 'webhook.gave_up' AND subject = $1", [o.invoice])).rows;
  assert.equal(audit.length, 1);
  assert.equal(audit[0].detail.outbox, o.id);
  const again = fakeApp();
  await deliverDue({ target, fetchImpl: again.fetchImpl, limit: 500, log: quiet });
  assert.equal(again.calls.filter((c) => JSON.parse(c.init.body).order_id === o.ref).length, 0, 'parked rows are not retried by themselves');
});

test('two senders at once send each row exactly once', { skip }, async () => {
  const rows = await Promise.all(Array.from({ length: 6 }, () => mk()));
  const app = fakeApp(async () => {
    await new Promise((r) => setTimeout(r, 20));
    return 200;
  });
  await Promise.all([deliverDue({ target, fetchImpl: app.fetchImpl, limit: 500, log: quiet }), deliverDue({ target, fetchImpl: app.fetchImpl, limit: 500, log: quiet })]);
  for (const o of rows) {
    assert.equal(app.calls.filter((c) => JSON.parse(c.init.body).order_id === o.ref).length, 1, `${o.ref} sent once`);
    assert.ok((await row(o.id)).delivered_at);
  }
});

test('without a target nothing is sent', { skip }, async () => {
  const saved = [process.env.APP_WEBHOOK_URL, process.env.GATEWAY_WEBHOOK_SECRET];
  delete process.env.APP_WEBHOOK_URL;
  delete process.env.GATEWAY_WEBHOOK_SECRET;
  try {
    const app = fakeApp();
    const r = await deliverDue({ fetchImpl: app.fetchImpl, log: quiet });
    assert.deepEqual(r, { claimed: 0, delivered: 0, failed: 0, parked: 0 });
    assert.equal(app.calls.length, 0);
  } finally {
    if (saved[0] !== undefined) process.env.APP_WEBHOOK_URL = saved[0];
    if (saved[1] !== undefined) process.env.GATEWAY_WEBHOOK_SECRET = saved[1];
  }
});
