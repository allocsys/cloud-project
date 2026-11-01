// #32: the invite code lookup limit follows the address the proxy saw (the last x-forwarded-for entry), not a first entry the caller can fake.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { NextRequest } = await import('next/server');
const { pool } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const route = await import('@/app/api/referrals/code/route');

const get = (xff) => route.GET(new NextRequest('http://app.test/api/referrals/code?c=NOSUCHCODE', { headers: { 'x-forwarded-for': xff } }));

before(async () => {
  await migrate();
});
after(async () => {
  await pool().end();
});

test('a forged first x-forwarded-for entry does not get around the 20 per minute limit', async () => {
  for (let i = 0; i < 20; i += 1) {
    const r = await get(`1.1.1.${i}, 203.0.113.9`); // a new fake address each time, the same real one
    assert.equal(r.status, 200, `request ${i + 1}`);
  }
  const over = await get('2.2.2.2, 203.0.113.9');
  assert.equal(over.status, 429);
  assert.deepEqual(await over.json(), { valid: false, rebate: 0 });
  // Another real address is not limited.
  assert.equal((await get('1.1.1.1, 203.0.113.10')).status, 200);
});
