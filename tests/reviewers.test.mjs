// View-only reviewers for /adtg: the admin adds and removes them, they can sign in and only read, and a removed one is out at once.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

const { pool } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const { act } = await import('@/lib/server/admin');
const { reviewerList, REVIEWER_MAX } = await import('@/lib/server/reviewers');
const login = await import('@/app/api/adtg/login/route');
const data = await import('@/app/api/adtg/route');

const was = process.env.ADMIN_TOKEN;
let n = 0;
const ip = () => `10.77.${Math.floor(n / 250)}.${(n += 1) % 250}`; // a new address each call, so the sign-in limit never gets in the way

const signIn = (user, pass) =>
  login.POST(new NextRequest('http://t/api/adtg/login', { method: 'POST', body: JSON.stringify({ user, pass }), headers: { 'content-type': 'application/json', 'x-forwarded-for': ip() } }));
const read = (cookie) => data.GET(new NextRequest('http://t/api/adtg', { headers: cookie ? { cookie: `vtx_review=${cookie}` } : {} }));
const cookieOf = (res) => res.cookies.get('vtx_review')?.value;
const add = (id, pass) => act({ action: 'reviewer-add', id, pass });
const remove = (id) => act({ action: 'reviewer-remove', id });

before(async () => {
  await migrate();
  process.env.ADMIN_TOKEN = 'reviewers-test-token-0123456789';
  for (const r of reviewerList()) await remove(r.user);
});

after(async () => {
  for (const r of reviewerList()) await remove(r.user);
  if (was === undefined) delete process.env.ADMIN_TOKEN;
  else process.env.ADMIN_TOKEN = was;
  await pool().end();
});

test('adding checks the name and the password, and refuses a repeat', async () => {
  assert.equal((await add('ab', 'long-enough-pass')).status, 422);
  assert.equal((await add('has space', 'long-enough-pass')).status, 422);
  assert.equal((await add('anna', 'short')).status, 422);
  const ok = await add(' Anna ', 'long-enough-pass');
  assert.ok(ok.ok, JSON.stringify(ok));
  assert.deepEqual(reviewerList().map((r) => r.user), ['anna']);
  assert.equal((await add('ANNA', 'another-long-pass')).status, 409);
  assert.equal(JSON.stringify(reviewerList()).includes('long-enough-pass'), false);
});

test('a reviewer signs in and reads people and money, without notes or ID photos', async () => {
  assert.equal((await signIn('anna', 'wrong-password-x')).status, 401);
  assert.equal((await signIn('nobody', 'long-enough-pass')).status, 401);
  const ok = await signIn('Anna', 'long-enough-pass');
  assert.equal(ok.status, 200);
  const c = cookieOf(ok);
  assert.ok(c);
  assert.equal((await read(null)).status, 401);
  assert.equal((await read('anna.9999999999999.deadbeef')).status, 401);
  const r = await read(c);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.who, 'anna');
  for (const k of ['stats', 'users', 'orders', 'withdrawals', 'refunds']) assert.ok(j[k], k);
  for (const k of ['catalog', 'smart', 'guard', 'reviews', 'log', 'reviewers', 'payProvider']) assert.equal(k in j, false, `${k} must not reach a reviewer`);
  for (const u of j.users) {
    assert.equal('note' in u, false);
    assert.equal('photos' in u.kyc, false);
  }
});

test('a reviewer has no way to change anything', async () => {
  assert.equal(data.POST, undefined);
  assert.equal(data.PUT, undefined);
  assert.equal(data.DELETE, undefined);
});

test('removing a reviewer ends their session at once, and a new account with the same name does not revive it', async () => {
  const c = cookieOf(await signIn('anna', 'long-enough-pass'));
  assert.equal((await read(c)).status, 200);
  assert.ok((await remove('anna')).ok);
  assert.equal((await read(c)).status, 401);
  assert.equal((await signIn('anna', 'long-enough-pass')).status, 401);
  assert.equal((await remove('anna')).status, 404);
  await new Promise((r) => setTimeout(r, 5)); // the new account gets a later stamp
  assert.ok((await add('anna', 'brand-new-password')).ok);
  assert.equal((await read(c)).status, 401);
  assert.equal((await signIn('anna', 'brand-new-password')).status, 200);
});

test('there is a limit on how many reviewers there can be', async () => {
  for (let i = reviewerList().length; i < REVIEWER_MAX; i += 1) assert.ok((await add(`rev${i}`, 'long-enough-pass')).ok);
  assert.equal(reviewerList().length, REVIEWER_MAX);
  assert.equal((await add('onetoomany', 'long-enough-pass')).status, 409);
});

test('without ADMIN_TOKEN the route is off', async () => {
  const keep = process.env.ADMIN_TOKEN;
  delete process.env.ADMIN_TOKEN;
  try {
    assert.equal((await signIn('anna', 'brand-new-password')).status, 503);
    assert.equal((await read('x')).status, 503);
  } finally {
    process.env.ADMIN_TOKEN = keep;
  }
});
