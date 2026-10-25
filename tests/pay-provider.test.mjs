import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { provider, cryptoEnabled, gatewayUrlOk, verifyGatewaySig, verifyCallback, verifySig, callbacksEnabled, readyFor, setProviderChoice } from '../lib/server/pay-provider.js';

const SECRET = 'whsec_test_secret';
const sortDeep = (v) =>
  Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])])) : v;
const sign = (body, secret = SECRET) => createHmac('sha512', secret).update(JSON.stringify(sortDeep(body))).digest('hex');

const payload = { order_id: 'ord_abc', payment_id: 'inv_1', payment_status: 'finished', price_amount: 99, price_currency: 'usd', pay_currency: 'btc', network: 'btc', pay_amount: '0.001', actually_paid: '0.001' };

function withEnv(env, fn) {
  const keys = ['PAY_PROVIDER', 'GATEWAY_URL', 'GATEWAY_API_SECRET', 'GATEWAY_WEBHOOK_SECRET', 'NOWPAYMENTS_API_KEY', 'NOWPAYMENTS_IPN_SECRET'];
  const old = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, env);
  try {
    return fn();
  } finally {
    for (const k of keys) old[k] === undefined ? delete process.env[k] : (process.env[k] = old[k]);
  }
}

test('provider defaults to nowpayments and only "gateway" switches it', () => {
  assert.equal(withEnv({}, provider), 'nowpayments');
  assert.equal(withEnv({ PAY_PROVIDER: 'nonsense' }, provider), 'nowpayments');
  assert.equal(withEnv({ PAY_PROVIDER: ' Gateway ' }, provider), 'gateway');
});

const LONG_A = 'a'.repeat(16);
const LONG_W = 'w'.repeat(16);

test('gateway needs url, api secret and webhook secret to be enabled', () => {
  assert.equal(withEnv({ PAY_PROVIDER: 'gateway' }, cryptoEnabled), false);
  assert.equal(withEnv({ PAY_PROVIDER: 'gateway', GATEWAY_URL: 'https://g.example', GATEWAY_API_SECRET: LONG_A }, cryptoEnabled), false);
  assert.equal(withEnv({ PAY_PROVIDER: 'gateway', GATEWAY_URL: 'https://g.example', GATEWAY_API_SECRET: LONG_A, GATEWAY_WEBHOOK_SECRET: LONG_W }, cryptoEnabled), true);
});

test('gateway secrets shorter than 16 characters keep it disabled', () => {
  const base = { PAY_PROVIDER: 'gateway', GATEWAY_URL: 'https://g.example' };
  assert.equal(withEnv({ ...base, GATEWAY_API_SECRET: 'a'.repeat(15), GATEWAY_WEBHOOK_SECRET: LONG_W }, cryptoEnabled), false);
  assert.equal(withEnv({ ...base, GATEWAY_API_SECRET: LONG_A, GATEWAY_WEBHOOK_SECRET: 'w'.repeat(15) }, cryptoEnabled), false);
});

test('gateway url: https, or http only on localhost and the Railway private network', () => {
  for (const ok of ['https://g.example', 'https://g.example/', 'http://localhost:4000', 'http://127.0.0.1:4000', 'http://gateway.railway.internal:8080']) {
    assert.equal(gatewayUrlOk(ok), true, ok);
  }
  for (const bad of ['', undefined, 'not a url', 'http://g.example', 'http://evilrailway.internal', 'http://x.railway.internal.evil.com', 'ftp://g.example', 'https://user:pw@g.example', 'javascript:alert(1)']) {
    assert.equal(gatewayUrlOk(bad), false, String(bad));
  }
  const env = { PAY_PROVIDER: 'gateway', GATEWAY_API_SECRET: LONG_A, GATEWAY_WEBHOOK_SECRET: LONG_W };
  assert.equal(withEnv({ ...env, GATEWAY_URL: 'http://g.example' }, cryptoEnabled), false);
  assert.equal(withEnv({ ...env, GATEWAY_URL: 'http://gateway.railway.internal:8080' }, cryptoEnabled), true);
});

test('valid signature returns the parsed body', () => {
  const raw = JSON.stringify(payload);
  const body = withEnv({ GATEWAY_WEBHOOK_SECRET: SECRET }, () => verifyGatewaySig(raw, sign(payload)));
  assert.deepEqual(body, payload);
});

test('key order in the delivered body does not matter', () => {
  const shuffled = JSON.stringify(Object.fromEntries(Object.entries(payload).reverse()));
  assert.ok(withEnv({ GATEWAY_WEBHOOK_SECRET: SECRET }, () => verifyGatewaySig(shuffled, sign(payload))));
});

test('nested objects are sorted recursively', () => {
  const nested = { ...payload, extra: { z: 1, a: { y: 2, b: 3 } } };
  assert.ok(withEnv({ GATEWAY_WEBHOOK_SECRET: SECRET }, () => verifyGatewaySig(JSON.stringify(nested), sign(nested))));
});

test('uppercase hex and surrounding spaces are accepted', () => {
  const raw = JSON.stringify(payload);
  assert.ok(withEnv({ GATEWAY_WEBHOOK_SECRET: SECRET }, () => verifyGatewaySig(raw, ` ${sign(payload).toUpperCase()} `)));
});

test('rejects a tampered body, wrong secret, missing or malformed signature', () => {
  const raw = JSON.stringify({ ...payload, price_amount: 1 });
  withEnv({ GATEWAY_WEBHOOK_SECRET: SECRET }, () => {
    assert.equal(verifyGatewaySig(raw, sign(payload)), null);
    assert.equal(verifyGatewaySig(JSON.stringify(payload), sign(payload, 'other')), null);
    assert.equal(verifyGatewaySig(JSON.stringify(payload), ''), null);
    assert.equal(verifyGatewaySig(JSON.stringify(payload), undefined), null);
    assert.equal(verifyGatewaySig(JSON.stringify(payload), 'zz'), null);
    assert.equal(verifyGatewaySig(JSON.stringify(payload), sign(payload).slice(0, 64)), null);
  });
});

test('rejects everything when no webhook secret is set, and non-object bodies', () => {
  assert.equal(withEnv({}, () => verifyGatewaySig(JSON.stringify(payload), sign(payload))), null);
  withEnv({ GATEWAY_WEBHOOK_SECRET: SECRET }, () => {
    assert.equal(verifyGatewaySig('not json', 'abc'), null);
    assert.equal(verifyGatewaySig('[1,2]', sign([1, 2])), null);
    assert.equal(verifyGatewaySig('null', 'abc'), null);
  });
});

test('verifyCallback checks the header the callback carries, whichever provider is in use', () => {
  const raw = JSON.stringify(payload);
  const gw = new Headers({ 'x-gateway-sig': sign(payload) });
  const np = new Headers({ 'x-nowpayments-sig': sign(payload, 'ipn-secret') });
  const both = { GATEWAY_WEBHOOK_SECRET: SECRET, NOWPAYMENTS_IPN_SECRET: 'ipn-secret' };
  for (const use of ['gateway', 'nowpayments']) {
    assert.ok(withEnv({ ...both, PAY_PROVIDER: use }, () => verifyCallback(raw, gw)), `gateway callback while ${use} is in use`);
    assert.ok(withEnv({ ...both, PAY_PROVIDER: use }, () => verifyCallback(raw, np)), `nowpayments callback while ${use} is in use`);
  }
  // A provider whose secret is not set, a wrong secret, or no header at all: nothing is accepted.
  assert.equal(withEnv({ NOWPAYMENTS_IPN_SECRET: 'ipn-secret' }, () => verifyCallback(raw, gw)), null);
  assert.equal(withEnv({ GATEWAY_WEBHOOK_SECRET: SECRET }, () => verifyCallback(raw, np)), null);
  assert.equal(withEnv({ ...both }, () => verifyCallback(raw, new Headers({ 'x-gateway-sig': sign(payload, 'other') }))), null);
  assert.equal(withEnv({ ...both }, () => verifyCallback(raw, new Headers())), null);
  assert.equal(withEnv({ NOWPAYMENTS_IPN_SECRET: 'ipn-secret' }, () => verifySig(raw, sign(payload, 'ipn-secret'))) !== null, true);
});

test('callbacks are on when either secret is set', () => {
  assert.equal(withEnv({}, callbacksEnabled), false);
  assert.equal(withEnv({ GATEWAY_WEBHOOK_SECRET: SECRET }, callbacksEnabled), true);
  assert.equal(withEnv({ NOWPAYMENTS_IPN_SECRET: 'x' }, callbacksEnabled), true);
});

test('the admin choice wins over PAY_PROVIDER, and clearing it gives the environment back', () => {
  try {
    setProviderChoice('gateway');
    assert.equal(withEnv({}, provider), 'gateway');
    setProviderChoice('nowpayments');
    assert.equal(withEnv({ PAY_PROVIDER: 'gateway' }, provider), 'nowpayments');
    setProviderChoice('nonsense');
    assert.equal(withEnv({ PAY_PROVIDER: 'gateway' }, provider), 'gateway');
    setProviderChoice(null);
    assert.equal(withEnv({}, provider), 'nowpayments');
  } finally {
    setProviderChoice(null);
  }
  assert.equal(withEnv({ NOWPAYMENTS_API_KEY: 'k', NOWPAYMENTS_IPN_SECRET: 's' }, () => readyFor('nowpayments')), true);
  assert.equal(withEnv({}, () => readyFor('nowpayments')), false);
  assert.equal(withEnv({}, () => readyFor('gateway')), false);
});
