import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { handler } from '../src/server.js';

delete process.env.DATABASE_URL;

const serve = () =>
  new Promise((resolve) => {
    const s = createServer((req, res) => handler(req, res));
    s.listen(0, '127.0.0.1', () => resolve(s));
  });

test('GET /health answers ok without a database', async () => {
  const s = await serve();
  try {
    const r = await fetch(`http://127.0.0.1:${s.address().port}/health`);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, service: 'vtx-gateway', db: 'off' });
  } finally {
    s.close();
  }
});

test('unknown route is 404', async () => {
  const s = await serve();
  try {
    const r = await fetch(`http://127.0.0.1:${s.address().port}/nope`);
    assert.equal(r.status, 404);
  } finally {
    s.close();
  }
});
