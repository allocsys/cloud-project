// Runs against a real Postgres (DATABASE_URL). Every test uses its own ids, so reruns on the same database are fine.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, q, tx, getUser, withUser, withIdem, metaUpdate } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');

const run = Date.now().toString(36);
const email = (n) => `${n}-${run}@test.dev`;
const PW = 'correct horse 1';
const many = (n, fn) => Promise.all(Array.from({ length: n }, fn));

before(async () => {
  // Two servers booting at the same moment must take turns.
  await Promise.all([migrate(), migrate()]);
});

after(async () => {
  await pool().end();
});

test('migrations are idempotent and create the schema', async () => {
  await migrate();
  const n = (await q('SELECT count(*)::int AS n FROM schema_migrations')).rows[0].n;
  assert.ok(n >= 1);
  for (const t of ['users', 'codes', 'orders', 'ledger', 'meta', 'idem', 'throttle']) {
    assert.ok((await q('SELECT to_regclass($1) AS t', [t])).rows[0].t, `table ${t} is missing`);
  }
  assert.equal((await q("SELECT 1 FROM meta WHERE key = 'authkey'")).rowCount, 1);
});

test('the same email signs up only once', async () => {
  const e = email('race');
  const rs = await many(6, () => auth.signup({ email: e, password: PW }));
  assert.equal(rs.filter((r) => r.ok).length, 1);
  assert.deepEqual([...new Set(rs.filter((r) => !r.ok).map((r) => r.status))], [409]);
  assert.equal((await q('SELECT count(*)::int AS n FROM users WHERE id = $1', [e])).rows[0].n, 1);
});

test('login accepts the right password only', async () => {
  const e = email('login');
  assert.ok((await auth.signup({ email: e, password: PW })).ok);
  assert.ok((await auth.login({ email: e, password: PW })).ok);
  assert.equal((await auth.login({ email: e, password: 'wrong password' })).status, 401);
  assert.equal((await auth.login({ email: email('nobody'), password: 'whatever12' })).status, 401);
});

test('concurrent changes to one account are not lost', async () => {
  const e = email('lock');
  assert.ok((await auth.signup({ email: e, password: PW })).ok);
  await many(20, () =>
    withUser(e, (u) => {
      u.withdrawn = (u.withdrawn || 0) + 1;
    }),
  );
  assert.equal((await getUser(e)).withdrawn, 20);
});

test('the same idempotency key runs the action once', async () => {
  const key = `test:${run}`;
  let calls = 0;
  const go = () =>
    tx((c) =>
      withIdem(c, key, async () => {
        calls += 1;
        await new Promise((r) => setTimeout(r, 100));
        return { ok: true, status: 200, n: calls };
      }),
    );
  const rs = await Promise.all([go(), go(), go()]);
  assert.equal(calls, 1);
  assert.ok(rs.every((r) => r.n === 1));
});

test('meta updates queue up instead of overwriting each other', async () => {
  const key = `ctr-${run}`;
  await many(15, () => metaUpdate(key, (cur) => ({ value: (cur || 0) + 1 })));
  assert.equal((await q('SELECT data FROM meta WHERE key = $1', [key])).rows[0].data, 15);
});

test('sign-in lockout counts concurrent failures and clears', async () => {
  const k = `ip-${run}`;
  assert.equal(await auth.throttled(k), false);
  await many(8, () => auth.noteFail(k));
  assert.equal(await auth.throttled(k), true);
  await auth.clearFails(k);
  assert.equal(await auth.throttled(k), false);
});
