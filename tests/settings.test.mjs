// Alert settings against a real Postgres: defaults, partial saves that merge, bad input ignored, accounts kept apart,
// saves made at the same moment all kept, and the /api/settings route with a real session cookie.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { NextRequest } = await import('next/server');
const { pool, q, getUser } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');
const { getSettings, saveSettings } = await import('@/lib/server/account');
const { account } = await import('@/lib/data');
const route = await import('@/app/api/settings/route');

const run = `s${Date.now().toString(36)}`;
const email = (n) => `${n}-${run}@test.dev`;
const PW = 'correct horse 1';
const many = (n, fn) => Promise.all(Array.from({ length: n }, (_, i) => fn(i)));

async function acct(name) {
  const e = email(name);
  assert.ok((await auth.signup({ email: e, password: PW })).ok);
  return e;
}

const cookieOf = async (id) => `${auth.COOKIE}=${await auth.newSession(id)}`;
const tamper = (cookie) => cookie.slice(0, -1) + (cookie.endsWith('A') ? 'B' : 'A');
async function call(handler, { cookie, method = 'GET', raw } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (raw !== undefined) headers['content-type'] = 'application/json';
  const res = await handler(new NextRequest('http://app.test/api/settings', { method, headers, body: raw }));
  return { status: res.status, body: await res.json() };
}
const get = (cookie) => call(route.GET, { cookie });
const post = (cookie, body) => call(route.POST, { cookie, method: 'POST', raw: typeof body === 'string' ? body : JSON.stringify(body) });

async function withAuthMode(value, fn) {
  const was = process.env.REQUIRE_AUTH;
  if (value === undefined) delete process.env.REQUIRE_AUTH;
  else process.env.REQUIRE_AUTH = value;
  try {
    return await fn();
  } finally {
    if (was === undefined) delete process.env.REQUIRE_AUTH;
    else process.env.REQUIRE_AUTH = was;
  }
}

before(async () => {
  await migrate();
});

after(async () => {
  await pool().end();
});

test('a new account starts with the default alerts', async () => {
  const id = await acct('def');
  assert.deepEqual(await getSettings(id), { alerts: account.alerts });
  assert.equal((await getUser(id)).prefs, undefined, 'nothing is stored until the user saves');
});

test('a save changes only the keys it names and keeps the rest, across calls', async () => {
  const id = await acct('merge');
  const first = await saveSettings(id, { alerts: { news: true } });
  assert.equal(first.status, 200);
  assert.ok(first.ok);
  assert.deepEqual(first.alerts, { ...account.alerts, news: true });

  const second = await saveSettings(id, { alerts: { payouts: false } });
  assert.deepEqual(second.alerts, { ...account.alerts, news: true, payouts: false });
  assert.deepEqual((await getSettings(id)).alerts, second.alerts, 'what was answered is what is stored');

  const back = await saveSettings(id, { alerts: { payouts: true, withdrawals: false } });
  assert.deepEqual(back.alerts, { payouts: true, withdrawals: false, news: true });
});

test('input that is not a true or false for a known alert is ignored', async () => {
  const id = await acct('bad');
  for (const patch of [undefined, null, 'x', 5, {}, { alerts: null }, { alerts: {} }, { alerts: { payouts: 'no', withdrawals: 1, news: null } }, { alerts: { bogus: true } }]) {
    const r = await saveSettings(id, patch);
    assert.equal(r.status, 400, JSON.stringify(patch));
    assert.equal(r.ok, false);
  }
  assert.deepEqual(await getSettings(id), { alerts: account.alerts });
  assert.equal((await getUser(id)).prefs, undefined, 'a refused save stores nothing');

  // A mixed patch keeps the valid part and drops the rest, so nothing unknown is ever stored.
  const mixed = await saveSettings(id, { alerts: { payouts: false, news: 'yes', bogus: true } });
  assert.ok(mixed.ok);
  assert.deepEqual(mixed.alerts, { ...account.alerts, payouts: false });
  assert.deepEqual((await getUser(id)).prefs, { alerts: { payouts: false } });
});

test('an unknown account is refused and not created', async () => {
  const id = `nobody-${run}@test.dev`;
  const r = await saveSettings(id, { alerts: { news: true } });
  assert.equal(r.status, 404);
  assert.equal((await q('SELECT 1 FROM users WHERE id = $1', [id])).rowCount, 0);
});

test('accounts keep their own alerts', async () => {
  const a = await acct('iso-a');
  const b = await acct('iso-b');
  assert.ok((await saveSettings(a, { alerts: { news: true, payouts: false } })).ok);
  assert.deepEqual(await getSettings(b), { alerts: account.alerts });
  assert.deepEqual((await getSettings(a)).alerts, { ...account.alerts, news: true, payouts: false });
});

test('saves made at the same moment are all kept', async () => {
  const id = await acct('race');
  const patches = [{ payouts: false }, { withdrawals: false }, { news: true }];
  const rs = await many(patches.length, (i) => saveSettings(id, { alerts: patches[i] }));
  assert.ok(rs.every((r) => r.ok));
  assert.deepEqual((await getSettings(id)).alerts, { payouts: false, withdrawals: false, news: true });
});

test('the route reads and saves for the signed-in account, and answers bad bodies with 400', async () => {
  const id = await acct('rt');
  const other = await acct('rt-x');
  const c = await cookieOf(id);

  const r0 = await get(c);
  assert.equal(r0.status, 200);
  assert.deepEqual(r0.body, { alerts: account.alerts });

  const r1 = await post(c, { alerts: { news: true } });
  assert.equal(r1.status, 200);
  assert.equal(r1.body.ok, true);
  assert.equal('status' in r1.body, false, 'the status goes in the HTTP code, not the body');
  assert.deepEqual(r1.body.alerts, { ...account.alerts, news: true });
  assert.deepEqual((await get(c)).body.alerts, r1.body.alerts);
  assert.deepEqual(await getSettings(other), { alerts: account.alerts }, 'another account is untouched');

  const bad = await post(c, { alerts: { news: 'yes' } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.ok, false);
  assert.equal((await post(c, '{nope')).status, 400);
  assert.equal((await post(c, '')).status, 400);
  assert.deepEqual((await get(c)).body.alerts, r1.body.alerts, 'refused saves change nothing');
});

test('with sign-in required, no session or a forged one cannot read or save', async () => {
  const id = await acct('req');
  await withAuthMode('1', async () => {
    const good = await cookieOf(id);
    for (const c of [undefined, tamper(good)]) {
      assert.equal((await get(c)).status, 401);
      assert.equal((await post(c, { alerts: { news: true } })).status, 401);
    }
    assert.deepEqual(await getSettings(id), { alerts: account.alerts });
    assert.equal((await post(good, { alerts: { news: true } })).status, 200);
    assert.equal((await getSettings(id)).alerts.news, true);
  });
});
