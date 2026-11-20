// Connect wallet in Telegram (TON Connect): the gateway's TON link becomes a transfer request. Pure function, no database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tonTx } from '../lib/ton-tx.js';

const TO = 'UQBvI0aFLnw2QbZgjMPCLRdtRHxhUyinQudg6sdiohIwg5jL';

test('TON link becomes a transfer', () => {
  assert.deepEqual(tonTx(`ton://transfer/${TO}?amount=1500000000`), { to: TO, amount: '1500000000' });
});

test('anything else gives null', () => {
  assert.equal(tonTx(TO), null);
  assert.equal(tonTx(''), null);
  assert.equal(tonTx(null), null);
  assert.equal(tonTx(`ton://transfer/${TO}`), null);
  assert.equal(tonTx(`ton://transfer/${TO}?amount=0`), null);
  assert.equal(tonTx(`ton://transfer/${TO}?amount=1.5`), null);
  assert.equal(tonTx(`ton://transfer/${TO}?amount=-5`), null);
  assert.equal(tonTx('ton://transfer/short?amount=5'), null);
  assert.equal(tonTx(`ethereum:0x1111111111111111111111111111111111111111@1?value=5`), null);
});
