// Miner IDs: new ones are VTX-0004405; miners bought before the rename keep OP-0004389 and still work.
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatSerial, serialNumber } from '@/lib/contracts';

test('a new miner ID starts with VTX-', () => {
  assert.equal(formatSerial(4405), 'VTX-0004405');
});

test('the number is read from both VTX- and old OP- IDs', () => {
  assert.equal(serialNumber('VTX-0004405'), 4405);
  assert.equal(serialNumber('OP-0004389'), 4389);
});
