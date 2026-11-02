import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { upload, download, listBackups, prune, stampOf } from '../src/store.js';
import { kvClient } from '../src/kv.js';

function fakeKv() {
  const m = new Map();
  return {
    m,
    async put(k, v) {
      m.set(k, Buffer.from(v));
    },
    async get(k) {
      return m.has(k) ? Buffer.from(m.get(k)) : null;
    },
    async del(k) {
      m.delete(k);
    },
    async list(prefix) {
      return [...m.keys()].filter((k) => k.startsWith(prefix)).sort();
    },
  };
}

const day = (n) => new Date(Date.UTC(2026, 10, n, 3, 0, 0));

test('upload splits into parts and download joins them back', async () => {
  const kv = fakeKv();
  const blob = crypto.randomBytes(2500);
  const meta = await upload(kv, blob, day(2), 1000);
  assert.equal(meta.parts, 3);
  assert.equal(meta.stamp, '2026-11-02T03-00-00Z');
  const got = await download(kv, meta.stamp);
  assert.deepEqual(got.blob, blob);
});

test('a damaged or missing part is caught', async () => {
  const kv = fakeKv();
  const meta = await upload(kv, crypto.randomBytes(2500), day(2), 1000);
  const k = `backup:${meta.stamp}:1`;
  kv.m.set(k, Buffer.from('x'.repeat(1000)));
  await assert.rejects(download(kv, meta.stamp), /checksum/);
  kv.m.delete(k);
  await assert.rejects(download(kv, meta.stamp), /missing part 1/);
  await assert.rejects(download(kv, 'nope'), /No finished backup/);
});

test('an empty file still uploads as one part', async () => {
  const kv = fakeKv();
  const meta = await upload(kv, Buffer.alloc(0), day(2));
  assert.equal(meta.parts, 1);
  assert.equal((await download(kv, meta.stamp)).blob.length, 0);
});

test('list is newest first and ignores unfinished uploads', async () => {
  const kv = fakeKv();
  await upload(kv, Buffer.from('a'), day(1));
  await upload(kv, Buffer.from('b'), day(3));
  kv.m.set(`backup:${stampOf(day(4))}:0`, Buffer.from('half')); // no meta
  assert.deepEqual(await listBackups(kv), [stampOf(day(3)), stampOf(day(1))]);
});

test('prune keeps the newest N and removes the rest, with unfinished uploads', async () => {
  const kv = fakeKv();
  for (let d = 1; d <= 20; d += 1) await upload(kv, Buffer.from(`n${d}`), day(d));
  kv.m.set(`backup:${stampOf(day(21))}:0`, Buffer.from('half'));
  const removed = await prune(kv, 14);
  const left = await listBackups(kv);
  assert.equal(left.length, 14);
  assert.equal(left[0], stampOf(day(20)));
  assert.equal(left[13], stampOf(day(7)));
  assert.equal(removed, 6 * 2 + 1); // 6 old backups (part + meta) and the unfinished one
  assert.equal([...kv.m.keys()].length, 14 * 2);
});

test('prune never removes the only backup', async () => {
  const kv = fakeKv();
  await upload(kv, Buffer.from('a'), day(1));
  await prune(kv, 0);
  assert.equal((await listBackups(kv)).length, 1);
});

test('kv client: auth, raw body, 404 and paged list', async () => {
  const calls = [];
  const fetchFn = async (url, opt = {}) => {
    calls.push({ url, opt });
    if (url.includes('/keys?')) {
      const second = url.includes('cursor=c1');
      return { ok: true, status: 200, json: async () => ({ result: [{ name: second ? 'backup:b' : 'backup:a' }], result_info: { cursor: second ? '' : 'c1' } }) };
    }
    if (opt.method === 'PUT') return { ok: true, status: 200 };
    return { ok: false, status: 404 };
  };
  const kv = kvClient({ account: 'acc', namespace: 'ns', token: 'tok', fetchFn });
  await kv.put('backup:x:0', Buffer.from('v'));
  assert.equal(calls[0].url, 'https://api.cloudflare.com/client/v4/accounts/acc/storage/kv/namespaces/ns/values/backup%3Ax%3A0');
  assert.equal(calls[0].opt.headers.Authorization, 'Bearer tok');
  assert.equal(await kv.get('missing'), null);
  assert.deepEqual(await kv.list('backup:'), ['backup:a', 'backup:b']);
});
