// Deposit API tests against a real Postgres (skipped without DATABASE_URL).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { q, closeDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { handler } from '../src/server.js';
import { deriveBtcAddress } from '../src/chains/btc.js';

const ZPUB = 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
const SECRET = 'test-secret-123';
process.env.GATEWAY_API_SECRET = SECRET;
process.env.BTC_XPUB = ZPUB;
process.env.RATE_SOURCE = 'static';
process.env.RATE_BTC_USD = '100000';

const skip = process.env.DATABASE_URL ? false : 'DATABASE_URL not set';
const run = `test-api-${Math.random().toString(36).slice(2, 8)}`;
let server;
let base;
let n = 0;
const ref = () => `${run}-${n++}`;

const call = async (method, path, body, auth = `Bearer ${SECRET}`) => {
  const r = await fetch(base + path, {
    method,
    headers: { ...(auth ? { authorization: auth } : {}), 'content-type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
};

before(async () => {
  if (skip) return;
  await migrate();
  server = createServer((req, res) => handler(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!skip) {
    await q('DELETE FROM invoices WHERE ref LIKE $1', [`${run}-%`]);
    server.close();
  }
  await closeDb();
});

test('requests without the right secret are refused', { skip }, async () => {
  assert.equal((await call('GET', '/v1/invoices/x', undefined, null)).status, 401);
  assert.equal((await call('GET', '/v1/invoices/x', undefined, 'Bearer wrong')).status, 401);
  assert.equal((await call('POST', '/v1/invoices', { ref: ref(), usd: 5 }, 'Basic abc')).status, 401);
});

test('an order gets a BTC address and an amount from the rate', { skip }, async () => {
  const r = ref();
  const res = await call('POST', '/v1/invoices', { ref: r, usd: 50, network: 'btc', asset: 'btc' });
  assert.equal(res.status, 201);
  const i = res.body.invoice;
  assert.equal(i.status, 'pending');
  assert.equal(i.usd, 50);
  assert.equal(i.amount, '0.00050000');
  assert.equal(i.amount_atomic, '50000');
  assert.equal(i.rate_usd, 100000);
  assert.ok(i.address.startsWith('bc1q'));
  assert.equal(i.uri, `bitcoin:${i.address}?amount=0.00050000`);
  assert.ok(new Date(i.expires_at) > new Date());
  const row = (await q('SELECT deriv_index FROM invoices WHERE ref = $1', [r])).rows[0];
  assert.equal(i.address, deriveBtcAddress(ZPUB, Number(row.deriv_index)));
});

test('the same ref returns the same invoice and uses no new address', { skip }, async () => {
  const a = await call('POST', '/v1/invoices', { ref: ref(), usd: 20 });
  const again = await call('POST', '/v1/invoices', { ref: a.body.invoice.ref, usd: 20 });
  assert.equal(again.status, 200);
  assert.equal(again.body.invoice.id, a.body.invoice.id);
  assert.equal(again.body.invoice.address, a.body.invoice.address);
  const b = await call('POST', '/v1/invoices', { ref: ref(), usd: 20 });
  const idx = async (x) => Number((await q('SELECT deriv_index FROM invoices WHERE ref = $1', [x.body.invoice.ref])).rows[0].deriv_index);
  assert.ok((await idx(b)) > (await idx(a)));
});

test('the same ref with different details is a conflict', { skip }, async () => {
  const r = ref();
  await call('POST', '/v1/invoices', { ref: r, usd: 20 });
  assert.equal((await call('POST', '/v1/invoices', { ref: r, usd: 21 })).status, 409);
});

test('ten parallel creates for one ref make one invoice', { skip }, async () => {
  const r = ref();
  const all = await Promise.all(Array.from({ length: 10 }, () => call('POST', '/v1/invoices', { ref: r, usd: 15 })));
  assert.ok(all.every((x) => x.status === 200 || x.status === 201));
  assert.equal(new Set(all.map((x) => x.body.invoice.id)).size, 1);
  assert.equal((await q('SELECT count(*)::int AS n FROM invoices WHERE ref = $1', [r])).rows[0].n, 1);
});

test('fifteen parallel orders get fifteen different addresses', { skip }, async () => {
  const all = await Promise.all(Array.from({ length: 15 }, () => call('POST', '/v1/invoices', { ref: ref(), usd: 9 })));
  assert.ok(all.every((x) => x.status === 201));
  assert.equal(new Set(all.map((x) => x.body.invoice.address)).size, 15);
});

test('bad input is refused', { skip }, async () => {
  const bad = [
    { ref: 'has space', usd: 5 },
    { ref: '', usd: 5 },
    { ref: ref(), usd: 0 },
    { ref: ref(), usd: -3 },
    { ref: ref(), usd: 'abc' },
    { ref: ref(), usd: 2_000_000 },
    { ref: ref() },
    { ref: ref(), usd: 5, network: 'ltc' },
    { ref: ref(), usd: 5, network: 'btc', asset: 'eth' },
    { ref: ref(), usd: 5, kind: 'other' },
    { ref: ref(), kind: 'deposit' },
  ];
  for (const b of bad) assert.equal((await call('POST', '/v1/invoices', b)).status, 400, JSON.stringify(b));
  assert.equal((await call('POST', '/v1/invoices', '{not json')).status, 400);
});

test('a wallet top-up needs no amount', { skip }, async () => {
  const res = await call('POST', '/v1/invoices', { ref: ref(), kind: 'deposit', user_ref: 'u_1' });
  assert.equal(res.status, 201);
  assert.equal(res.body.invoice.amount, null);
  assert.equal(res.body.invoice.uri, `bitcoin:${res.body.invoice.address}`);
});

test('a wallet top-up under the $30 minimum is refused, orders are not affected', { skip }, async () => {
  assert.equal((await call('POST', '/v1/invoices', { ref: ref(), kind: 'deposit', user_ref: 'u_1', usd: 29.99 })).status, 400);
  assert.equal((await call('POST', '/v1/invoices', { ref: ref(), kind: 'deposit', user_ref: 'u_1', usd: 30 })).status, 201);
  assert.equal((await call('POST', '/v1/invoices', { ref: ref(), kind: 'order', usd: 5 })).status, 201);
});

test('an invoice can be read back, and an unknown one is 404', { skip }, async () => {
  const a = await call('POST', '/v1/invoices', { ref: ref(), usd: 12 });
  const got = await call('GET', `/v1/invoices/${a.body.invoice.ref}`);
  assert.equal(got.status, 200);
  assert.equal(got.body.invoice.id, a.body.invoice.id);
  assert.equal((await call('GET', '/v1/invoices/nope-nope')).status, 404);
});

test('no rate means no invoice, and no address is used up', { skip }, async () => {
  const r = ref();
  process.env.RATE_BTC_USD = '';
  try {
    assert.equal((await call('POST', '/v1/invoices', { ref: r, usd: 5 })).status, 503);
  } finally {
    process.env.RATE_BTC_USD = '100000';
  }
  assert.equal((await q('SELECT count(*)::int AS n FROM invoices WHERE ref = $1', [r])).rows[0].n, 0);
});

test('an unconfigured network is refused', { skip }, async () => {
  process.env.BTC_XPUB = '';
  try {
    assert.equal((await call('POST', '/v1/invoices', { ref: ref(), usd: 5 })).status, 503);
  } finally {
    process.env.BTC_XPUB = ZPUB;
  }
});

test('creating an invoice leaves an audit row', { skip }, async () => {
  const a = await call('POST', '/v1/invoices', { ref: ref(), usd: 7 });
  const r = await q("SELECT count(*)::int AS n FROM audit_log WHERE action = 'invoice.create' AND subject = $1", [a.body.invoice.id]);
  assert.equal(r.rows[0].n, 1);
});
