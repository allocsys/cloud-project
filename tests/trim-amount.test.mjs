import test from 'node:test';
import assert from 'node:assert/strict';
import { trimAmount } from '../lib/pay-coins.js';

test('trailing zeros of a coin amount go, the value stays the same', () => {
  assert.equal(trimAmount('346.017000000000000000'), '346.017');
  assert.equal(trimAmount('0.226001627864156002'), '0.226001627864156002');
  assert.equal(trimAmount('0.00123456'), '0.00123456');
  assert.equal(trimAmount('10.000'), '10');
  assert.equal(trimAmount('100'), '100');
  assert.equal(trimAmount('0.100'), '0.1');
});

test('anything that is not a plain decimal comes back as it is', () => {
  assert.equal(trimAmount(null), '');
  assert.equal(trimAmount(undefined), '');
  assert.equal(trimAmount('?'), '?');
  assert.equal(trimAmount('1e-7'), '1e-7');
  assert.equal(trimAmount(26.75), '26.75');
});
