// Payment links: EIP-681 for EVM networks, Solana Pay for Solana. Pure functions, no database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evmChain, EVM } from '../src/chains/evm.js';
import { solChain, SOL_TOKENS } from '../src/chains/sol.js';

const TO = '0x1111111111111111111111111111111111111111';

test('EVM native coin link carries chain id and wei', () => {
  assert.equal(evmChain('eth').uri(TO, '0.5', 'eth', '500000000000000000'), `ethereum:${TO}@1?value=500000000000000000`);
  assert.equal(evmChain('bsc').uri(TO, '1', 'bnb', '1000000000000000000'), `ethereum:${TO}@56?value=1000000000000000000`);
  assert.equal(evmChain('pol').uri(TO, '2', 'pol', '2000000000000000000'), `ethereum:${TO}@137?value=2000000000000000000`);
});

test('EVM token link is a transfer call on the token contract', () => {
  assert.equal(
    evmChain('eth').uri(TO, '50.123456', 'usdt', '50123456'),
    `ethereum:${EVM.eth.tokens.usdt.contract}@1/transfer?address=${TO}&uint256=50123456`,
  );
  assert.equal(
    evmChain('pol').uri(TO, '10', 'usdc', '10000000'),
    `ethereum:${EVM.pol.tokens.usdc.contract}@137/transfer?address=${TO}&uint256=10000000`,
  );
});

test('EVM link falls back to the plain address without a usable amount', () => {
  assert.equal(evmChain('eth').uri(TO, null, 'eth', null), TO);
  assert.equal(evmChain('eth').uri(TO, '0', 'eth', '0'), TO);
  assert.equal(evmChain('eth').uri(TO, '1', 'doge', '100'), TO);
});

test('Solana Pay link has trimmed amount and the token mint', () => {
  const to = 'So11111111111111111111111111111111111111112';
  assert.equal(solChain().uri(to, '0.250000000', 'sol', '250000000'), `solana:${to}?amount=0.25`);
  assert.equal(solChain().uri(to, '40.123456', 'usdt', '40123456'), `solana:${to}?amount=40.123456&spl-token=${SOL_TOKENS.usdt.mint}`);
  assert.equal(solChain().uri(to, null, 'sol', null), to);
});
