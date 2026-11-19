import test from 'node:test';
import assert from 'node:assert/strict';
import { guarded, capWaiters, Shed, BUSY } from '@/lib/server/shed';
import { sessionCache } from '@/lib/server/session-cache';
import { checkAccount } from '@/lib/server/auth';
import { clearCounters, ACCOUNT_LIMITS } from '@/lib/rate-mem';

const fakePool = (waiting) => ({
  waitingCount: waiting,
  calls: 0,
  connect(cb) {
    this.calls += 1;
    if (cb) return void process.nextTick(cb, null, 'client');
    return Promise.resolve('client');
  },
});

test('a guarded route is refused with 503 once too many requests wait for the pool', async () => {
  const pool = capWaiters(fakePool(20), 20);
  const route = guarded(async () => pool.connect());
  const res = await route();
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('retry-after'), '3');
  assert.equal((await res.json()).error, BUSY);
  assert.equal(pool.calls, 0, 'the queue was never joined');
});

test('the callback form (pool.query connects this way) is refused too', async () => {
  const pool = capWaiters(fakePool(25), 20);
  const err = await guarded(
    () => new Promise((resolve) => pool.connect((e) => resolve(e))),
  )();
  assert.ok(err instanceof Shed && err.status === 503);
});

test('below the cap, or outside a guarded route, the pool is used as before', async () => {
  const quiet = capWaiters(fakePool(19), 20);
  assert.equal(await guarded(async () => quiet.connect())(), 'client');
  const busy = capWaiters(fakePool(500), 20);
  assert.equal(await busy.connect(), 'client'); // a job or the payment webhook: not a guarded route
  assert.equal(busy.calls, 1);
});

test('guarded keeps other errors as errors', async () => {
  await assert.rejects(guarded(async () => { throw new Error('boom'); })(), /boom/);
});

test('one account is limited per minute, the shared demo account is not', () => {
  clearCounters();
  const read = { method: 'GET', nextUrl: { pathname: '/api/wallet' } };
  const write = { method: 'POST', nextUrl: { pathname: '/api/settings' } };
  const bundle = { method: 'GET', nextUrl: { pathname: '/api/dashboard/bundle' } };
  for (let i = 0; i < ACCOUNT_LIMITS.bundle; i += 1) checkAccount('a@x.test', bundle);
  assert.throws(() => checkAccount('a@x.test', bundle), (e) => e instanceof Shed && e.status === 429 && e.retry === 60);
  checkAccount('a@x.test', read); // reads have their own counter
  for (let i = 0; i < ACCOUNT_LIMITS.write - 1; i += 1) checkAccount('b@x.test', write);
  checkAccount('b@x.test', write);
  assert.throws(() => checkAccount('b@x.test', write), (e) => e.status === 429);
  checkAccount('c@x.test', write); // another account is untouched
  for (let i = 0; i < 1000; i += 1) checkAccount('demo', read);
});

test('the session memory expires, forgets an account, and ignores an older check', () => {
  let t = 1000;
  const c = sessionCache(2000, 5, () => t);
  assert.equal(c.get('tok'), null);
  c.set('tok', 'a', c.mark());
  assert.equal(c.get('tok'), 'a');
  t += 1999;
  assert.equal(c.get('tok'), 'a');
  t += 2;
  assert.equal(c.get('tok'), null, 'gone after 2 seconds');

  c.set('t1', 'a', c.mark());
  c.set('t2', 'b', c.mark());
  c.forget('a');
  assert.equal(c.get('t1'), null);
  assert.equal(c.get('t2'), 'b');

  const seen = c.mark(); // a check starts ...
  c.forget('b'); // ... the password changes meanwhile ...
  c.set('t3', 'b', seen); // ... its older answer must not be stored
  assert.equal(c.get('t3'), null);

  for (let i = 0; i < 20; i += 1) c.set(`k${i}`, 'z', c.mark());
  assert.ok([...Array(20).keys()].filter((i) => c.get(`k${i}`)).length <= 5, 'size is capped');
});
