import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { provider, cryptoEnabled, verifyGatewaySig, verifyCallback } from '../lib/server/pay-provider.js';

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

test('gateway needs url, api secret and webhook secret to be enabled', () => {
  assert.equal(withEnv({ PAY_PROVIDER: 'gateway' }, cryptoEnabled), false);
  assert.equal(withEnv({ PAY_PROVIDER: 'gateway', GATEWAY_URL: 'https://g.example', GATEWAY_API_SECRET: 'a' }, cryptoEnabled), false);
  assert.equal(withEnv({ PAY_PROVIDER: 'gateway', GATEWAY_URL: 'https://g.example', GATEWAY_API_SECRET: 'a', GATEWAY_WEBHOOK_SECRET: 'w' }, cryptoEnabled), true);
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

test('verifyCallback reads the header of the active provider only', () => {
  const raw = JSON.stringify(payload);
  const gw = new Headers({ 'x-gateway-sig': sign(payload) });
  assert.ok(withEnv({ PAY_PROVIDER: 'gateway', GATEWAY_WEBHOOK_SECRET: SECRET }, () => verifyCallback(raw, gw)));
  // A gateway signature is not accepted while NOWPayments is the provider.
  assert.equal(withEnv({ GATEWAY_WEBHOOK_SECRET: SECRET, NOWPAYMENTS_IPN_SECRET: 'x' }, () => verifyCallback(raw, gw)), null);
});
