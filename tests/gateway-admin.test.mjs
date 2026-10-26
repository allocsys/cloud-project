import test from 'node:test';
import assert from 'node:assert/strict';
import { gatewayOverview, handleUnmatched } from '../lib/server/gateway-admin.js';

const KEYS = ['GATEWAY_URL', 'GATEWAY_API_SECRET'];
const SECRET = 's'.repeat(16);

async function withEnv(env, fetchImpl, fn) {
  const old = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  const oldFetch = globalThis.fetch;
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  if (fetchImpl) globalThis.fetch = fetchImpl;
  try {
    return await fn();
  } finally {
    for (const k of KEYS) old[k] === undefined ? delete process.env[k] : (process.env[k] = old[k]);
    globalThis.fetch = oldFetch;
  }
}

test('gateway overview is off without a gateway url and a long enough secret', async () => {
  assert.equal((await withEnv({}, null, gatewayOverview)).off, true);
  assert.equal((await withEnv({ GATEWAY_URL: 'https://g.example', GATEWAY_API_SECRET: 'short' }, null, gatewayOverview)).off, true);
  assert.equal((await withEnv({ GATEWAY_URL: 'http://g.example', GATEWAY_API_SECRET: SECRET }, null, gatewayOverview)).off, true);
});

test('gateway overview calls the admin route with the Bearer secret and returns the answer', async () => {
  const seen = [];
  const fetchImpl = async (url, opts) => {
    seen.push({ url, auth: opts.headers.authorization });
    return new Response(JSON.stringify({ ok: true, networks: [], scanners: [] }), { status: 200 });
  };
  const r = await withEnv({ GATEWAY_URL: 'https://g.example/', GATEWAY_API_SECRET: SECRET }, fetchImpl, gatewayOverview);
  assert.equal(r.ok, true);
  assert.deepEqual(r.networks, []);
  assert.deepEqual(seen, [{ url: 'https://g.example/v1/admin/overview', auth: `Bearer ${SECRET}` }]);
});

test('gateway overview turns a bad answer or a network failure into a short error, never the secret', async () => {
  const env = { GATEWAY_URL: 'https://g.example', GATEWAY_API_SECRET: SECRET };
  const bad = await withEnv(env, async () => new Response('nope', { status: 401 }), gatewayOverview);
  assert.deepEqual(bad, { ok: false, error: 'The gateway answered 401.' });
  const down = await withEnv(env, async () => { throw new Error(`boom ${SECRET}`); }, gatewayOverview);
  assert.deepEqual(down, { ok: false, error: 'The gateway cannot be reached.' });
});

test('handleUnmatched checks its input before it calls the gateway', async () => {
  const env = { GATEWAY_URL: 'https://g.example', GATEWAY_API_SECRET: SECRET };
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return new Response('{}', { status: 200 });
  };
  const tx = 'a'.repeat(64);
  const bad = [
    null,
    { network: 'nope', txid: tx, vout: 0 },
    { network: 'btc', txid: '', vout: 0 },
    { network: 'btc', txid: 'x'.repeat(129), vout: 0 },
    { network: 'btc', txid: tx, vout: -1 },
    { network: 'btc', txid: tx, vout: '0' },
  ];
  for (const b of bad) assert.deepEqual(await withEnv(env, fetchImpl, () => handleUnmatched(b)), { ok: false, error: 'Invalid request.' });
  const long = await withEnv(env, fetchImpl, () => handleUnmatched({ network: 'btc', txid: tx, vout: 0, note: 'n'.repeat(81) }));
  assert.equal(long.ok, false);
  assert.equal(calls, 0);
  assert.equal((await withEnv({}, fetchImpl, () => handleUnmatched({ network: 'btc', txid: tx, vout: 0 }))).off, true);
  assert.equal(calls, 0);
});

test('handleUnmatched posts to the gateway with the Bearer secret and reports the result', async () => {
  const env = { GATEWAY_URL: 'https://g.example/', GATEWAY_API_SECRET: SECRET };
  const tx = 'b'.repeat(64);
  const seen = [];
  const fetchImpl = (status, body) => async (url, opts) => {
    seen.push({ url, method: opts.method, auth: opts.headers.authorization, body: JSON.parse(opts.body) });
    return new Response(JSON.stringify(body), { status });
  };
  const input = { network: 'pol', txid: tx, vout: 0, note: '  sent back  ' };
  const ok = await withEnv(env, fetchImpl(200, { ok: true, handled: true }), () => handleUnmatched(input));
  assert.deepEqual(ok, { ok: true });
  assert.deepEqual(seen, [{ url: 'https://g.example/v1/admin/unmatched/handle', method: 'POST', auth: `Bearer ${SECRET}`, body: { network: 'pol', txid: tx, vout: 0, note: 'sent back' } }]);
  const gone = await withEnv(env, fetchImpl(404, { ok: false, error: 'Not found.' }), () => handleUnmatched(input));
  assert.equal(gone.ok, false);
  const bad = await withEnv(env, fetchImpl(401, { ok: false }), () => handleUnmatched(input));
  assert.deepEqual(bad, { ok: false, error: 'The gateway answered 401.' });
  const down = await withEnv(env, async () => { throw new Error(`boom ${SECRET}`); }, () => handleUnmatched(input));
  assert.deepEqual(down, { ok: false, error: 'The gateway cannot be reached.' });
});
