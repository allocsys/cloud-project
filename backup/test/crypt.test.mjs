import test from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, decrypt } from '../src/crypt.js';

const KEY = 'a-long-test-key-0123456789-abc';

test('encrypt then decrypt returns the same bytes', () => {
  const data = Buffer.from('hello backup \u00e9\n'.repeat(1000));
  const blob = encrypt(data, KEY);
  assert.notDeepEqual(blob.subarray(5), data);
  assert.deepEqual(decrypt(blob, KEY), data);
});

test('two encryptions of the same data differ (random salt and iv)', () => {
  const d = Buffer.from('same');
  assert.notDeepEqual(encrypt(d, KEY), encrypt(d, KEY));
});

test('wrong key fails', () => {
  const blob = encrypt(Buffer.from('secret'), KEY);
  assert.throws(() => decrypt(blob, 'another-long-test-key-0123456789'), /Wrong key/);
});

test('a changed byte fails', () => {
  const blob = encrypt(Buffer.from('secret data here'), KEY);
  blob[blob.length - 20] ^= 1;
  assert.throws(() => decrypt(blob, KEY), /Wrong key|damaged/);
});

test('not a backup, and short keys, are refused', () => {
  assert.throws(() => decrypt(Buffer.from('nope nope nope nope nope nope nope nope nope nope'), KEY), /not an encrypted/);
  assert.throws(() => encrypt(Buffer.from('x'), 'short'), /at least 24/);
});
