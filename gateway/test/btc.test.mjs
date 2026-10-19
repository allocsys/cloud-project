import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBase58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha256';
import { normalizeXpub, deriveBtcAddress } from '../src/chains/btc.js';

// BIP84 test vector: account 0 of the seed "abandon ... about".
const ZPUB = 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
const b58c = createBase58check(sha256);

const withVersion = (key, v) => {
  const raw = b58c.decode(key);
  new DataView(raw.buffer, raw.byteOffset, 4).setUint32(0, v);
  return b58c.encode(raw);
};

test('BIP84 vector: first two receive addresses', () => {
  assert.equal(deriveBtcAddress(ZPUB, 0), 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
  assert.equal(deriveBtcAddress(ZPUB, 1), 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g');
});

test('a zpub and the same key as an xpub give the same addresses', () => {
  const { xpub } = normalizeXpub(ZPUB);
  assert.ok(xpub.startsWith('xpub'));
  assert.equal(deriveBtcAddress(xpub, 0), deriveBtcAddress(ZPUB, 0));
  assert.equal(deriveBtcAddress(xpub, 7), deriveBtcAddress(ZPUB, 7));
});

test('a testnet key gives tb1q addresses', () => {
  const tpub = withVersion(ZPUB, 0x043587cf);
  assert.ok(tpub.startsWith('tpub'));
  assert.ok(deriveBtcAddress(tpub, 0).startsWith('tb1q'));
});

test('addresses differ by index and are stable', () => {
  const seen = new Set();
  for (let i = 0; i < 20; i++) seen.add(deriveBtcAddress(ZPUB, i));
  assert.equal(seen.size, 20);
  assert.equal(deriveBtcAddress(ZPUB, 3), deriveBtcAddress(ZPUB, 3));
});

test('a private extended key is refused, and never echoed', () => {
  const xprv = withVersion(ZPUB, 0x0488ade4);
  assert.throws(() => deriveBtcAddress(xprv, 0), (e) => /PUBLIC/.test(e.message) && !e.message.includes(xprv));
});

test('garbage keys are refused', () => {
  for (const k of ['', 'abc', 'xpub123', null, undefined, ZPUB.slice(0, -2) + 'zz']) {
    assert.throws(() => deriveBtcAddress(k, 0), /extended public key|Unsupported/);
  }
});

test('bad indexes are refused', () => {
  for (const i of [-1, 1.5, 0x80000000, NaN, '1', null]) assert.throws(() => deriveBtcAddress(ZPUB, i), /index/);
});
