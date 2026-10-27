// Trust Wallet link for an open invoice. Pure function, no database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trustLink } from '../lib/trust-link.js';

const TO = '0x1111111111111111111111111111111111111111';
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL_TO = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';

test('native coins carry no token id', () => {
  assert.equal(trustLink({ network: 'btc', asset: 'btc', address: 'bc1qtest', amount: '0.001' }), 'https://link.trustwallet.com/send?coin=0&address=bc1qtest&amount=0.001');
  assert.equal(trustLink({ network: 'eth', asset: 'eth', address: TO, amount: '0.5' }), `https://link.trustwallet.com/send?coin=60&address=${TO}&amount=0.5`);
  assert.match(trustLink({ network: 'bsc', asset: 'bnb', address: TO, amount: '1' }), /coin=20000714/);
  assert.match(trustLink({ network: 'pol', asset: 'pol', address: TO, amount: '1' }), /coin=966/);
  assert.match(trustLink({ network: 'sol', asset: 'sol', address: SOL_TO, amount: '2' }), /coin=501&/);
  assert.match(trustLink({ network: 'trx', asset: 'trx', address: 'TTest', amount: '9' }), /coin=195&/);
});

test('tokens take the contract or mint from the payment link', () => {
  const evm = trustLink({ network: 'eth', asset: 'usdt', address: TO, amount: '5', uri: `ethereum:${USDT}@1/transfer?address=${TO}&uint256=5000000` });
  assert.ok(evm.endsWith(`&token_id=${USDT}`));
  const sol = trustLink({ network: 'sol', asset: 'usdc', address: SOL_TO, amount: '5', uri: `solana:${SOL_TO}?amount=5&spl-token=${MINT}` });
  assert.ok(sol.endsWith(`&token_id=${MINT}`));
  const trx = trustLink({ network: 'trx', asset: 'usdt', address: 'TTest', amount: '5', uri: 'TTest' });
  assert.ok(trx.endsWith('&token_id=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'));
});

test('trailing zeros are trimmed; bad input gives null', () => {
  assert.match(trustLink({ network: 'btc', asset: 'btc', address: 'bc1qtest', amount: '0.00120000' }), /amount=0\.0012$/);
  assert.equal(trustLink({ network: 'eth', asset: 'usdt', address: TO, amount: '5', uri: TO }), null);
  assert.equal(trustLink({ network: 'btc', asset: 'btc', address: 'bc1qtest', amount: '0' }), null);
  assert.equal(trustLink({ network: 'btc', asset: 'btc', address: '', amount: '1' }), null);
  assert.equal(trustLink({ network: 'doge', asset: 'btc', address: 'x', amount: '1' }), null);
  assert.equal(trustLink(null), null);
});
