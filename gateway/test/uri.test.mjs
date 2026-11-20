// Payment links: EIP-681 for EVM networks. Pure functions, no database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evmChain, EVM } from '../src/chains/evm.js';

const TO = '0x1111111111111111111111111111111111111111';

test('EVM native coin link carries chain id and wei', () => {
  assert.equal(evmChain('eth').uri(TO, '0.5', 'eth', '500000000000000000'), `ethereum:${TO}@1?value=500000000000000000`);
  assert.equal(evmChain('bsc').uri(TO, '1', 'bnb', '1000000000000000000'), `ethereum:${TO}@56?value=1000000000000000000`);
});

test('EVM token link is a transfer call on the token contract', () => {
  assert.equal(
    evmChain('eth').uri(TO, '50.123456', 'usdt', '50123456'),
    `ethereum:${EVM.eth.tokens.usdt.contract}@1/transfer?address=${TO}&uint256=50123456`,
  );
  assert.equal(
    evmChain('bsc').uri(TO, '10', 'usdt', '10000000000000000000'),
    `ethereum:${EVM.bsc.tokens.usdt.contract}@56/transfer?address=${TO}&uint256=10000000000000000000`,
  );
});

test('EVM link falls back to the plain address without a usable amount', () => {
  assert.equal(evmChain('eth').uri(TO, null, 'eth', null), TO);
  assert.equal(evmChain('eth').uri(TO, '0', 'eth', '0'), TO);
  assert.equal(evmChain('eth').uri(TO, '1', 'doge', '100'), TO);
  assert.equal(evmChain('eth').uri(TO, '1', 'usdc', '1000000'), TO, 'USDC is not taken');
});

test('only Ethereum and BNB Chain are EVM networks, and USDT is their only token', () => {
  assert.deepEqual(Object.keys(EVM), ['eth', 'bsc']);
  for (const e of Object.values(EVM)) assert.deepEqual(Object.keys(e.tokens), ['usdt']);
});
