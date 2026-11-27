// Gradual delay on password guessing: counted per name from all addresses, for users, Admin and /adtg.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { NextRequest } = await import('next/server');
const { pool, q, slowTry, slowWait } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');
const { translateError } = await import('@/lib/i18n/errors');
const userRoute = await import('@/app/api/auth/login/route');
const adtgRoute = await import('@/app/api/adtg/login/route');
const adminRoute = await import('@/app/api/admin/login/route');

const run = `ld${Date.now().toString(36)}`;
const PW = 'correct horse 1';
const was = process.env.ADMIN_TOKEN;
let n = 0;
async function post(route, body) {
  n += 1;
  const headers = { 'content-type': 'application/json', 'x-forwarded-for': `10.88.${Math.floor(n / 250)}.${n % 250}` }; // a new address each time
  const res = await route.POST(new NextRequest('http://app.test/x', { method: 'POST', headers, body: JSON.stringify(body) }));
  return { status: res.status, retry: Number(res.headers.get('retry-after') || 0), body: await res.json() };
}
const open = (key) => q('DELETE FROM throttle WHERE key = $1', [`${key}:wait`]); // as if the wait has passed

before(async () => {
  await migrate();
  process.env.ADMIN_TOKEN = 'login-delay-test-token-0123456789';
});
after(async () => {
  if (was === undefined) delete process.env.ADMIN_TOKEN;
  else process.env.ADMIN_TOKEN = was;
  await pool().end();
});

test('the wait grows and stops at 60 seconds', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 50].map(slowWait), [0, 0, 2, 4, 8, 16, 32, 60, 60]);
});

test('a burst of parallel tries cannot pass the delay', async () => {
  const r = await Promise.all(Array.from({ length: 12 }, () => slowTry(`burst:${run}`)));
  assert.equal(r.filter((w) => w === 0).length, 3);
});

async function check(route, good, bad, key) {
  for (let i = 0; i < 3; i += 1) assert.equal((await post(route, bad)).status, 401, `free try ${i + 1}`);
  const slowed = await post(route, good); // even the right password waits, from a new address
  assert.equal(slowed.status, 429);
  assert.ok(slowed.retry >= 1 && slowed.retry <= 2, String(slowed.retry));
  assert.equal(slowed.body.error, `Too many attempts. Try again in ${slowed.retry} seconds.`);
  await open(key);
  assert.equal((await post(route, good)).status, 200);
  assert.equal((await q('SELECT 1 FROM throttle WHERE key IN ($1, $2)', [key, `${key}:wait`])).rowCount, 0, 'success clears the count');
}

test('user sign-in is delayed', async () => {
  const email = `u-${run}@test.dev`;
  assert.ok((await auth.signup({ email, password: PW })).ok);
  await check(userRoute, { email, password: PW }, { email, password: 'wrong password' }, `auth:a:${email}`);
});

test('/adtg sign-in is delayed', async () => {
  const { addReviewer, removeReviewer } = await import('@/lib/server/reviewers');
  const user = `r${run}`.slice(0, 30);
  assert.ok((await addReviewer(user, PW)).ok);
  try {
    await check(adtgRoute, { user, pass: PW }, { user: user.toUpperCase(), pass: 'wrong password' }, `review:name:${user}`);
  } finally {
    await removeReviewer(user);
  }
});

test('Admin sign-in is delayed', async () => {
  const { metaGet, metaSet, metaDelete, warm } = await import('@/lib/server/db');
  const { setupAdmin } = await import('@/lib/server/admin');
  await warm(true);
  const keep = metaGet('admin');
  await metaDelete('admin');
  try {
    assert.ok((await setupAdmin(process.env.ADMIN_TOKEN, 'boss', PW)).ok);
    await check(adminRoute, { user: 'boss', pass: PW }, { user: 'boss', pass: 'wrong password' }, 'admin:name:boss');
  } finally {
    if (keep) await metaSet('admin', keep);
    else await metaDelete('admin');
  }
});

test('the message is translated', async () => {
  const { setClientMessages } = await import('@/lib/i18n/client');
  const { LANGS } = await import('@/lib/i18n/langs');
  setClientMessages('fa', LANGS.fa.messages);
  assert.equal(translateError('fa', 'Too many attempts. Try again in 8 seconds.'), LANGS.fa.messages['err.waitSec'].replace('{s}', '8'));
});
