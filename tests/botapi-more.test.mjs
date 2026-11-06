// Bot -> app signed API: /earnings and /referrals.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, tx, withUser, createUser, getUser } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const { signBody } = await import('@/lib/server/botnotify');
const { serve, earningsFor, referralsFor } = await import('@/lib/server/botapi');
const { applyLink } = await import('@/lib/server/referrals');

const SECRET = 'k'.repeat(32);
const env = { APP_BOT_SECRET: SECRET };
const call = (fn, extra) => {
  const body = { sent_at: new Date().toISOString(), ...extra };
  return serve(JSON.stringify(body), signBody(body, SECRET), fn, { env });
};
const tgId = (n) => 8000000 + ((Date.now() + n) % 1000000);

before(async () => {
  await migrate();
});
after(async () => {
  await pool().end();
});

test('/earnings and /referrals: bad id 400, no account 404 and nothing is created', async () => {
  for (const fn of [earningsFor, referralsFor]) {
    assert.equal((await call(fn, { tg_id: 'x' })).status, 400);
    assert.equal((await call(fn, { tg_id: 0 })).status, 400);
    assert.equal((await call(fn, {})).status, 400);
    const id = tgId(1);
    assert.equal((await call(fn, { tg_id: id })).status, 404);
    assert.equal((await pool().query('SELECT 1 FROM users WHERE id = $1', [`tg:${id}`])).rowCount, 0);
  }
});

test('/earnings: an account with no miner says so, with zeros', async () => {
  const n = tgId(2);
  await tx((c) => createUser(c, `tg:${n}`));
  const r = await call(earningsFor, { tg_id: n });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.miners, false);
  assert.equal(r.json.today, 0);
  assert.equal(r.json.total, 0);
  assert.equal(r.json.avgUsd, 0);
});

test('/earnings: an account with a miner has numbers that are finite and never negative', async () => {
  const n = tgId(3);
  const id = `tg:${n}`;
  await tx((c) => createUser(c, id));
  await withUser(id, (u) => {
    u.contracts.push({ serial: 'VTX-0009001', plan: 'Custom', name: 'Custom', th: 10, hall: 'tx-1', days: 30, dailyUsd: 5, price: 100, startedAt: Date.now() - 3 * 86400000, online: true });
  });
  const r = await call(earningsFor, { tg_id: n });
  assert.equal(r.status, 200);
  assert.equal(r.json.miners, true);
  for (const k of ['today', 'total', 'avgUsd']) assert.ok(Number.isFinite(r.json[k]) && r.json[k] >= 0, k);
});

test('/referrals: the default code, no friends yet, VIP 0', async () => {
  const n = tgId(4);
  const id = `tg:${n}`;
  await tx((c) => createUser(c, id));
  const r = await call(referralsFor, { tg_id: n });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.code, (await getUser(id)).refCode);
  assert.match(r.json.code, /^VTX-/);
  assert.equal(r.json.friends, 0);
  assert.equal(r.json.active, 0);
  assert.equal(r.json.earned, 0);
  assert.equal(r.json.vip, 0);
});

test('/referrals: a friend who signed up counts as a friend, not yet active', async () => {
  const inv = tgId(5);
  const fr = tgId(6);
  await tx((c) => createUser(c, `tg:${inv}`));
  await tx((c) => createUser(c, `tg:${fr}`));
  const code = (await getUser(`tg:${inv}`)).refCode;
  const linked = await withUser(`tg:${fr}`, (f, c) => applyLink(c, f, code));
  assert.equal(linked.ok, true);
  const r = await call(referralsFor, { tg_id: inv });
  assert.equal(r.status, 200);
  assert.equal(r.json.friends, 1);
  assert.equal(r.json.active, 0);
  assert.equal(r.json.earned, 0);
});

test('/earnings and /referrals: an email account is not reachable by a Telegram id', async () => {
  await tx((c) => createUser(c, `more${Date.now()}@x.test`));
  assert.equal((await call(earningsFor, { tg_id: 1234567890124 })).status, 404);
  assert.equal((await call(referralsFor, { tg_id: 1234567890124 })).status, 404);
});
