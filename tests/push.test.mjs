// Phone notices (lib/server/push.js): config, signed token request, message text per language, dead tokens, the account's phone list,
// and, against a real Postgres, a notice reaching the phone after COMMIT and a phone moving to the account that signed in last.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';

const push = await import('@/lib/server/push');
const { pool, withUser, getUser, notify } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');
const { addPhone, dropPhone } = await import('@/lib/server/account');

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA = { project_id: 'vtx-test', client_email: 'push@vtx-test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
const ENV = { FCM_SERVICE_ACCOUNT: JSON.stringify(SA) };
const TOK = (n) => `tok_${n}_${'x'.repeat(30)}`;
const run = `p${Date.now().toString(36)}`;

before(async () => {
  await migrate();
});
after(async () => {
  await pool().end();
});

test('config: empty is off, JSON or base64 is on, broken is off', () => {
  assert.equal(push.fcmConfig({}), null);
  assert.equal(push.fcmConfig({ FCM_SERVICE_ACCOUNT: '{nope' }), null);
  assert.equal(push.fcmConfig(ENV).projectId, 'vtx-test');
  assert.equal(push.fcmConfig({ FCM_SERVICE_ACCOUNT: Buffer.from(JSON.stringify(SA)).toString('base64') }).email, SA.client_email);
});

test('the token request is signed with the service account key', () => {
  const jwt = push.signedJwt(push.fcmConfig(ENV), 1_800_000_000_000);
  const [h, c, s] = jwt.split('.');
  assert.ok(createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(s, 'base64url')));
  const claim = JSON.parse(Buffer.from(c, 'base64url').toString());
  assert.equal(claim.iss, SA.client_email);
  assert.equal(claim.exp - claim.iat, 3600);
});

test('the message uses the bell words in the phone language and opens the notices page', () => {
  const note = { id: 'n1', code: 'welcome' };
  const en = push.fcmMessage(TOK(1), note, 'en').message;
  const fa = push.fcmMessage(TOK(1), note, 'fa').message;
  assert.equal(en.notification.title, 'Welcome to Vertexhash');
  assert.notEqual(fa.notification.title, en.notification.title);
  assert.equal(en.data.url, '/notifications');
  assert.equal(en.android.notification.tag, 'n1');
  assert.equal(push.fcmMessage(TOK(1), note, 'xx').message.notification.title, en.notification.title, 'unknown language = English');
});

test('dead tokens: 404 and UNREGISTERED; a server error is not', () => {
  assert.equal(push.deadToken(404, {}), true);
  assert.equal(push.deadToken(400, { error: { status: 'INVALID_ARGUMENT', message: 'The registration token is not a valid FCM registration token' } }), true);
  assert.equal(push.deadToken(500, { error: { status: 'INTERNAL' } }), false);
});

test('phone list: newest first, no repeats, at most 5, bad tokens ignored', () => {
  let u = {};
  for (let i = 0; i < 7; i += 1) u = { push: push.withPhone(u, TOK(i), 'en') };
  assert.equal(u.push.length, push.MAX_TOKENS);
  assert.equal(u.push[0].t, TOK(6));
  u = { push: push.withPhone(u, TOK(3), 'fa') };
  assert.equal(u.push[0].t, TOK(3));
  assert.equal(u.push[0].lang, 'fa');
  assert.equal(u.push.filter((p) => p.t === TOK(3)).length, 1);
  assert.deepEqual(push.phonesOf({ push: [{ t: 'short' }, null] }), []);
});

// A fake Firebase: answers the token request, records the sends, says 404 for tokens in `dead`.
function fakeFcm(dead = []) {
  const sent = [];
  const fetchFn = async (url, init) => {
    if (url.includes('oauth2')) return new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), { status: 200 });
    const m = JSON.parse(init.body).message;
    sent.push(m);
    return dead.includes(m.token) ? new Response(JSON.stringify({ error: { status: 'NOT_FOUND' } }), { status: 404 }) : new Response('{}', { status: 200 });
  };
  return { sent, fetchFn };
}

test('sending: every phone of every job; dead ones are handed to drop; off = nothing', async () => {
  const { sent, fetchFn } = fakeFcm([TOK(2)]);
  const dropped = [];
  const jobs = [{ userId: 'a', note: { id: 'n', code: 'welcome' }, phones: [{ t: TOK(1), lang: 'en' }, { t: TOK(2), lang: 'fa' }] }];
  await push.sendPushJobs(jobs, { env: ENV, fetchFn, drop: async (id, t) => dropped.push([id, t]) });
  assert.equal(sent.length, 2);
  assert.deepEqual(dropped, [['a', [TOK(2)]]]);
  const off = fakeFcm();
  await push.sendPushJobs(jobs, { env: {}, fetchFn: off.fetchFn });
  assert.equal(off.sent.length, 0);
});

test('accounts: a phone moves to the account that signed in last; sign-out forgets it; bad token refused', async () => {
  const a = (await auth.signup({ email: `a-${run}@test.dev`, password: 'correct horse 1' })).id;
  const b = (await auth.signup({ email: `b-${run}@test.dev`, password: 'correct horse 1' })).id;
  const t = TOK(`m${run}`);
  assert.equal((await addPhone(a, t, 'fa')).ok, true);
  assert.equal((await getUser(a)).push[0].lang, 'fa');
  assert.equal((await addPhone(b, t, 'en')).ok, true);
  assert.equal((await getUser(a)).push.length, 0, 'gone from the first account');
  assert.equal((await getUser(b)).push[0].t, t);
  assert.equal((await dropPhone(b, t)).ok, true);
  assert.equal((await getUser(b)).push.length, 0);
  assert.equal((await addPhone(a, 'bad token', 'en')).ok, false);
});

test('a notice inside a transaction reaches the phone after COMMIT', async () => {
  const a = (await auth.signup({ email: `c-${run}@test.dev`, password: 'correct horse 1' })).id;
  const t = TOK(`n${run}`);
  await addPhone(a, t, 'en');
  const { sent, fetchFn } = fakeFcm();
  const keepFetch = globalThis.fetch;
  const keepEnv = process.env.FCM_SERVICE_ACCOUNT;
  globalThis.fetch = fetchFn;
  process.env.FCM_SERVICE_ACCOUNT = ENV.FCM_SERVICE_ACCOUNT;
  try {
    await withUser(a, (u) => notify(u, { code: 'welcome' }));
    for (let i = 0; i < 50 && !sent.some((m) => m.token === t); i += 1) await new Promise((r) => setTimeout(r, 20));
    const m = sent.find((x) => x.token === t);
    assert.ok(m, 'sent to the phone');
    assert.equal(m.notification.title, 'Welcome to Vertexhash');
  } finally {
    globalThis.fetch = keepFetch;
    if (keepEnv === undefined) delete process.env.FCM_SERVICE_ACCOUNT;
    else process.env.FCM_SERVICE_ACCOUNT = keepEnv;
  }
});
