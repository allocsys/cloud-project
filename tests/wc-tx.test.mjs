// Connect wallet: the gateway's payment link becomes a transaction request. Pure functions, no database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evmTx } from '../lib/wc-tx.js';

const TO = '0x1111111111111111111111111111111111111111';
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';

test('native coin link becomes a value transfer', () => {
  assert.deepEqual(evmTx(`ethereum:${TO}@1?value=500000000000000000`), { chainId: 1, to: TO, value: '0x6f05b59d3b20000', data: '0x' });
  assert.equal(evmTx(`ethereum:${TO}@56?value=1000000000000000000`).chainId, 56);
  assert.equal(evmTx(`ethereum:${TO}@137?value=1`).value, '0x1');
});

test('token link becomes an ERC-20 transfer call', () => {
  const tx = evmTx(`ethereum:${USDT}@1/transfer?address=${TO}&uint256=5000000`);
  assert.equal(tx.chainId, 1);
  assert.equal(tx.to, USDT);
  assert.equal(tx.value, '0x0');
  assert.equal(tx.data, `0xa9059cbb${'0'.repeat(24)}${'1'.repeat(40)}${'0'.repeat(58)}4c4b40`);
  assert.equal(tx.data.length, 2 + 8 + 64 + 64);
});

test('anything else gives null', () => {
  assert.equal(evmTx(TO), null);
  assert.equal(evmTx('bitcoin:bc1qabc?amount=0.1'), null);
  assert.equal(evmTx(`ethereum:${TO}@42161?value=1`), null);
  assert.equal(evmTx(`ethereum:${TO}@1?value=0`), null);
  assert.equal(evmTx(`ethereum:${TO}@1?value=1.5`), null);
  assert.equal(evmTx(`ethereum:${USDT}@1/transfer?address=nope&uint256=1`), null);
  assert.equal(evmTx(`ethereum:${USDT}@1/transfer?address=${TO}`), null);
  assert.equal(evmTx(''), null);
  assert.equal(evmTx(null), null);
});
