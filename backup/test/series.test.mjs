import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { parse } from '../src/apply.js';
import { FORMAT, VERSION } from '../src/dump.js';
import { upload, listBackups, prune, download, APP, GATEWAY } from '../src/store.js';

function fakeKv() {
  const m = new Map();
  return {
    m,
    put: async (k, v) => void m.set(k, Buffer.from(v)),
    get: async (k) => (m.has(k) ? Buffer.from(m.get(k)) : null),
    del: async (k) => void m.delete(k),
    list: async (p) => [...m.keys()].filter((k) => k.startsWith(p)).sort(),
  };
}
const day = (n) => new Date(Date.UTC(2026, 10, n, 3, 0, 0));

test('app and gateway backups are separate series', async () => {
  const kv = fakeKv();
  for (let d = 1; d <= 5; d += 1) {
    await upload(kv, Buffer.from(`app${d}`), day(d), undefined, APP);
    await upload(kv, Buffer.from(`gw${d}`), day(d), undefined, GATEWAY);
  }
  assert.equal((await listBackups(kv, APP)).length, 5);
  assert.equal((await listBackups(kv, GATEWAY)).length, 5);
  await prune(kv, 2, GATEWAY);
  assert.equal((await listBackups(kv, GATEWAY)).length, 2);
  assert.equal((await listBackups(kv, APP)).length, 5); // the app series is untouched
  const newest = (await listBackups(kv, GATEWAY))[0];
  assert.equal((await download(kv, newest, GATEWAY)).blob.toString(), 'gw5');
  await assert.rejects(download(kv, newest, APP).then((r) => r.blob.toString().startsWith('gw') && Promise.reject(new Error('mixed'))), /mixed|No finished/);
});

test('apply.parse reads a dump file and rejects other files', () => {
  const head = { format: FORMAT, version: VERSION, at: 'x', schema: ['0001'], sequences: {}, tables: [{ name: 't', rows: 2 }] };
  const file = zlib.gzipSync(Buffer.from(`${[JSON.stringify(head), '{"a":1}', '{"a":2}'].join('\n')}\n`));
  const p = parse(file);
  assert.equal(p.total, 2);
  assert.throws(() => parse(zlib.gzipSync(Buffer.from('{"format":"other"}\n'))), /not a backup/);
  assert.throws(() => parse(Buffer.from('nope')), /not a Vertexhash backup/);
  const short = zlib.gzipSync(Buffer.from(`${[JSON.stringify(head), '{"a":1}'].join('\n')}\n`));
  assert.throws(() => parse(short), /damaged/);
});
