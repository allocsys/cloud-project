// Link code for the Telegram bot: who can ask, what is stored, one per minute, a new code replaces the old one.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { NextRequest } = await import('next/server');
const { pool, tx, createUser, getUser, withUser } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');
const { botLinkStart, linkHash, LINK_MS, LINK_WAIT_MS } = await import('@/lib/server/botlink');
const route = await import('@/app/api/account/bot-link/route');

const run = `bl${Date.now().toString(36)}`;
const PW = 'correct horse 1';
const account = async (name) => {
  const e = `${name}-${run}@test.dev`;
  assert.ok((await auth.signup({ email: e, password: PW })).ok);
  return e;
};
const post = async (cookie) => {
  const headers = { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.7' };
  if (cookie) headers.cookie = cookie;
  const res = await route.POST(new NextRequest('http://app.test/api/account/bot-link', { method: 'POST', headers }));
  return { status: res.status, body: await res.json() };
};

before(async () => {
  await migrate();
});
after(async () => {
  await pool().end();
});

test('an email account gets a code; only its hash is kept', async () => {
  const id = await account('a');
  const r = await botLinkStart(id);
  assert.equal(r.ok, true);
  assert.match(r.code, /^[A-HJKMNP-Z2-9]{8}$/);
  const u = await getUser(id);
  assert.equal(u.botLink.h, linkHash(r.code));
  assert.equal(linkHash(r.code), linkHash(` ${r.code.toLowerCase()} `), 'typed in lower case or with spaces still matches');
  assert.ok(!JSON.stringify(u).includes(r.code), 'the code itself is not stored');
  assert.ok(Math.abs(u.botLink.exp - (Date.now() + LINK_MS)) < 5000, 'valid 10 minutes');
  assert.equal(r.expires, u.botLink.exp);
});

test('a second code within a minute is refused; later it replaces the first', async () => {
  const id = await account('b');
  const first = await botLinkStart(id);
  assert.equal(first.ok, true);
  const again = await botLinkStart(id);
  assert.equal(again.status, 429);
  assert.equal((await getUser(id)).botLink.h, linkHash(first.code), 'the first code still stands');
  await withUser(id, (u) => {
    u.botLink.at -= LINK_WAIT_MS + 1000;
  });
  const second = await botLinkStart(id);
  assert.equal(second.ok, true);
  assert.notEqual(second.code, first.code);
  assert.equal((await getUser(id)).botLink.h, linkHash(second.code), 'the old code no longer matches');
});

test('demo, Telegram and unknown accounts get no code; a linked account is told so', async () => {
  assert.equal((await botLinkStart('demo')).status, 403);
  assert.equal((await botLinkStart(null)).status, 403);
  const tgId = `tg:${7000000 + (Date.now() % 1000000)}`;
  await tx((c) => createUser(c, tgId));
  assert.equal((await botLinkStart(tgId)).status, 403);
  assert.equal((await botLinkStart(`nobody-${run}@test.dev`)).status, 404);
  const id = await account('c');
  await withUser(id, (u) => {
    u.botTg = 123456;
  });
  const r = await botLinkStart(id);
  assert.equal(r.status, 409);
  assert.equal((await getUser(id)).botLink, undefined);
});

test('the route needs a signed-in account, gives a code, and keeps the one-minute wait', async () => {
  const noCookie = await post();
  assert.ok([401, 403].includes(noCookie.status), `no session: ${noCookie.status}`);
  assert.equal(noCookie.body.ok, false);
  const id = await account('d');
  const ok = await post(`${auth.COOKIE}=${await auth.newSession(id)}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.ok, true);
  assert.match(ok.body.code, /^[A-HJKMNP-Z2-9]{8}$/);
  assert.ok(ok.body.expires > Date.now());
  const wait = await post(`${auth.COOKIE}=${await auth.newSession(id)}`);
  assert.equal(wait.status, 429);
  assert.equal(wait.body.ok, false);
});
