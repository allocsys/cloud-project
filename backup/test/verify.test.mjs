import test from 'node:test';
import assert from 'node:assert/strict';
import { encrypt } from '../src/crypt.js';
import { upload, APP } from '../src/store.js';
import { verifyLatest } from '../src/verify.js';

function fakeKv() {
  const m = new Map();
  return {
    put: async (k, v) => void m.set(k, Buffer.from(v)),
    get: async (k) => (m.has(k) ? Buffer.from(m.get(k)) : null),
    del: async (k) => void m.delete(k),
    list: async (p) => [...m.keys()].filter((k) => k.startsWith(p)).sort(),
  };
}
const pool = { connect: async () => assert.fail('the database must not be touched before the file is opened') };
const KEY = 'a-long-test-key-0123456789-abc';

test('restore check: no backup yet', async () => {
  await assert.rejects(verifyLatest({ kv: fakeKv(), pool, secret: KEY, prefix: APP }), /no finished backup/);
});

test('restore check: wrong key is caught before the database is used', async () => {
  const kv = fakeKv();
  await upload(kv, encrypt(Buffer.from('dump'), KEY), new Date(), undefined, APP);
  await assert.rejects(verifyLatest({ kv, pool, secret: 'another-long-test-key-9876543210', prefix: APP }), /Wrong key/);
});

test('restore check: a file that is not a dump is caught', async () => {
  const kv = fakeKv();
  await upload(kv, encrypt(Buffer.from('not a gzip dump'), KEY), new Date(), undefined, APP);
  await assert.rejects(verifyLatest({ kv, pool, secret: KEY, prefix: APP }), /not a Vertexhash backup/);
});
