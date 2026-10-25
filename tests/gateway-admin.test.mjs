import test from 'node:test';
import assert from 'node:assert/strict';
import { gatewayOverview } from '../lib/server/gateway-admin.js';

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
