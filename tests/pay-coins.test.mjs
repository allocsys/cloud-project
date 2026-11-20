import { test } from 'node:test';
import assert from 'node:assert/strict';
import { payChoice, PAY_ASSETS, PAY_NETS, DEFAULT_PAY } from '../lib/pay-coins.js';

test('nothing chosen means Bitcoin', () => {
  assert.deepEqual(payChoice({}), { asset: 'btc', net: 'btc' });
  assert.deepEqual(payChoice(undefined), DEFAULT_PAY);
});

test('a coin without a network gets its first network', () => {
  assert.deepEqual(payChoice({ asset: 'usdt' }), { asset: 'usdt', net: 'eth' });
  assert.deepEqual(payChoice({ asset: 'bnb' }), { asset: 'bnb', net: 'bsc' });
});

test('a coin on a network it does not live on is refused', () => {
  assert.equal(payChoice({ asset: 'usdt', network: 'trx' }), null);
  assert.equal(payChoice({ asset: 'btc', network: 'eth' }), null);
  assert.equal(payChoice({ asset: 'eth', network: 'bsc' }), null);
});

test('USDT can be paid on Ethereum, BNB Chain and TON, and nothing else is taken', () => {
  for (const net of ['eth', 'bsc', 'ton']) assert.deepEqual(payChoice({ asset: 'usdt', network: net }), { asset: 'usdt', net });
  assert.deepEqual(Object.keys(PAY_ASSETS), ['btc', 'eth', 'bnb', 'ton', 'usdt']);
  for (const asset of ['trx', 'sol', 'pol', 'usdc']) assert.equal(payChoice({ asset }), null, asset);
});

test('unknown or odd input is refused', () => {
  for (const asset of ['doge', '', 'constructor', '__proto__', 'toString']) assert.equal(payChoice({ asset }), null);
  assert.equal(payChoice({ asset: 'btc', network: 'constructor' }), null);
});

test('every network a coin lists has a name', () => {
  for (const a of Object.values(PAY_ASSETS)) for (const n of a.nets) assert.ok(PAY_NETS[n], n);
});
