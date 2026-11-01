// #28: readJson reads a JSON body of at most `max` bytes and throws (so a route answers 400) when it is too big or not JSON.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { readJson } = await import('@/lib/server/body');

const post = (body, headers = {}) => new Request('http://localhost/x', { method: 'POST', body, headers });
const chunked = (parts, size) =>
  new Request('http://localhost/x', {
    method: 'POST',
    duplex: 'half',
    body: new ReadableStream({
      start(c) {
        for (let i = 0; i < parts; i += 1) c.enqueue(new TextEncoder().encode('a'.repeat(size)));
        c.close();
      },
    }),
  });

test('readJson parses a normal body', async () => {
  assert.deepEqual(await readJson(post(JSON.stringify({ a: 1, b: 'é' }))), { a: 1, b: 'é' });
});

test('readJson refuses a body over the limit (64 KB by default, or the one given)', async () => {
  const big = JSON.stringify({ pad: 'x'.repeat(70 * 1024) });
  await assert.rejects(readJson(post(big)), /too large/);
  assert.deepEqual((await readJson(post(big), 80 * 1024)).pad.length, 70 * 1024);
  await assert.rejects(readJson(post('{"a":"1234567890"}'), 10), /too large/);
});

test('readJson counts a chunked body that has no Content-Length', async () => {
  assert.equal(chunked(3, 400).headers.get('content-length'), null);
  await assert.rejects(readJson(chunked(3, 400), 1000), /too large/);
});

test('readJson trusts the real size, not a small Content-Length header', async () => {
  const big = JSON.stringify({ pad: 'x'.repeat(2000) });
  await assert.rejects(readJson(post(big, { 'content-length': '10' }), 1000), /too large|Unexpected|Invalid/);
});

test('readJson throws on an empty body or invalid JSON', async () => {
  await assert.rejects(readJson(new Request('http://localhost/x', { method: 'POST' })));
  await assert.rejects(readJson(post('not json')));
});
