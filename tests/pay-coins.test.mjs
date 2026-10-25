import { test } from 'node:test';
import assert from 'node:assert/strict';
import { payChoice, PAY_ASSETS, PAY_NETS, DEFAULT_PAY } from '../lib/pay-coins.js';

test('nothing chosen means Bitcoin', () => {
  assert.deepEqual(payChoice({}), { asset: 'btc', net: 'btc' });
  assert.deepEqual(payChoice(undefined), DEFAULT_PAY);
});

test('a coin without a network gets its first network', () => {
  assert.deepEqual(payChoice({ asset: 'usdt' }), { asset: 'usdt', net: 'trx' });
  assert.deepEqual(payChoice({ asset: 'bnb' }), { asset: 'bnb', net: 'bsc' });
  assert.deepEqual(payChoice({ asset: 'USDC' }), { asset: 'usdc', net: 'sol' });
});

test('a coin on a network it does not live on is refused', () => {
  assert.equal(payChoice({ asset: 'usdc', network: 'trx' }), null);
  assert.equal(payChoice({ asset: 'btc', network: 'eth' }), null);
  assert.equal(payChoice({ asset: 'eth', network: 'bsc' }), null);
});

test('stable coins can be paid on every network they run on', () => {
  for (const net of ['trx', 'eth', 'bsc', 'pol', 'sol']) assert.deepEqual(payChoice({ asset: 'usdt', network: net }), { asset: 'usdt', net });
  for (const net of ['eth', 'bsc', 'pol', 'sol']) assert.deepEqual(payChoice({ asset: 'usdc', network: net }), { asset: 'usdc', net });
});

test('unknown or odd input is refused', () => {
  for (const asset of ['doge', '', 'constructor', '__proto__', 'toString']) assert.equal(payChoice({ asset }), null);
  assert.equal(payChoice({ asset: 'btc', network: 'constructor' }), null);
});

test('every network a coin lists has a name', () => {
  for (const a of Object.values(PAY_ASSETS)) for (const n of a.nets) assert.ok(PAY_NETS[n], n);
});
