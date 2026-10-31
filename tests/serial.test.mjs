// Miner IDs look like VTX-0004405.
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatSerial, serialNumber } from '@/lib/contracts';

test('a new miner ID starts with VTX-', () => {
  assert.equal(formatSerial(4405), 'VTX-0004405');
});

test('the number is read from a VTX- ID', () => {
  assert.equal(serialNumber('VTX-0004405'), 4405);
});
