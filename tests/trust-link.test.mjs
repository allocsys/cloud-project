// Trust Wallet link for an open invoice. Pure function, no database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trustLink } from '../lib/trust-link.js';

const TO = '0x1111111111111111111111111111111111111111';
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';

test('native coins carry no token id', () => {
  assert.equal(trustLink({ network: 'btc', asset: 'btc', address: 'bc1qtest', amount: '0.001' }), 'https://link.trustwallet.com/send?coin=0&address=bc1qtest&amount=0.001');
  assert.equal(trustLink({ network: 'eth', asset: 'eth', address: TO, amount: '0.5' }), `https://link.trustwallet.com/send?coin=60&address=${TO}&amount=0.5`);
  assert.match(trustLink({ network: 'bsc', asset: 'bnb', address: TO, amount: '1' }), /coin=20000714/);
  assert.equal(trustLink({ network: 'pol', asset: 'pol', address: TO, amount: '1' }), null, 'Polygon is not taken');
  assert.equal(trustLink({ network: 'trx', asset: 'trx', address: 'TTest', amount: '9' }), null, 'Tron is not taken');
});

test('tokens take the contract from the payment link', () => {
  const evm = trustLink({ network: 'eth', asset: 'usdt', address: TO, amount: '5', uri: `ethereum:${USDT}@1/transfer?address=${TO}&uint256=5000000` });
  assert.ok(evm.endsWith(`&token_id=${USDT}`));
});

test('trailing zeros are trimmed; bad input gives null', () => {
  assert.match(trustLink({ network: 'btc', asset: 'btc', address: 'bc1qtest', amount: '0.00120000' }), /amount=0\.0012$/);
  assert.equal(trustLink({ network: 'eth', asset: 'usdt', address: TO, amount: '5', uri: TO }), null);
  assert.equal(trustLink({ network: 'btc', asset: 'btc', address: 'bc1qtest', amount: '0' }), null);
  assert.equal(trustLink({ network: 'btc', asset: 'btc', address: '', amount: '1' }), null);
  assert.equal(trustLink({ network: 'doge', asset: 'btc', address: 'x', amount: '1' }), null);
  assert.equal(trustLink(null), null);
});
