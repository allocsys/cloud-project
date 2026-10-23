// "Renew at term end" for Smart Mining against a real Postgres: the switch, the step that buys the same plan again once the term is
// over, and the cases where it does not (switch off, term still running, balance short, Smart Mining off, already renewed).
// Settings changed here are put back in a finally block, so other test files see the defaults.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { NextRequest } = await import('next/server');
const { pool, q, getUser, withUser } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');
const miners = await import('@/lib/server/miners');
const { renewDue } = await import('@/lib/server/renew');
const { act } = await import('@/lib/server/admin');
const route = await import('@/app/api/miners/[serial]/route');

const DAY = 86400000;
const run = `r${Date.now().toString(36)}`;
const PW = 'correct horse 1';
const many = (n, fn) => Promise.all(Array.from({ length: n }, (_, i) => fn(i)));

async function account(name) {
  const e = `${name}-${run}@test.dev`;
  assert.ok((await auth.signup({ email: e, password: PW })).ok);
  return e;
}
// Test money: a negative "withdrawn" adds to the available balance.
const credit = (id, btc) =>
  withUser(id, (u) => {
    u.withdrawn = (u.withdrawn || 0) - btc;
  });
const buy = (id, body = {}) => miners.buyPlan({ planId: 'smart', pay: 'balance', budget: 100, days: 90, ...body }, { userId: id });
// Moves a miner's start back so its term is long over, and sets its switch as asked.
const age = (id, serial, renew) =>
  withUser(id, (u) => {
    const c = u.contracts.find((x) => x.serial === serial);
    c.startedAt -= (c.days + 10) * DAY;
    if (renew) c.renew = true;
  });
const spendRows = async (id) => (await q("SELECT usd, ref FROM ledger WHERE user_id = $1 AND kind = 'spend' ORDER BY id", [id])).rows;

before(async () => {
  await migrate();
});

after(async () => {
  await pool().end();
});

test('the switch is off by default and can be turned on and off while the term runs', async () => {
  const id = await account('sw');
  await credit(id, 1);
  const r = await buy(id);
  assert.ok(r.ok);
  const s = r.contract.serial;
  assert.equal(r.contract.renew, undefined);

  assert.deepEqual(await miners.setRenew(id, s, true), { ok: true, status: 200, renew: true });
  assert.equal((await getUser(id)).contracts[0].renew, true);
  const m = await miners.getMiner(s, id);
  assert.equal(m.renew, true);
  assert.equal(m.renewable, true);

  assert.deepEqual(await miners.setRenew(id, s, false), { ok: true, status: 200, renew: false });
  assert.equal((await getUser(id)).contracts[0].renew, undefined);
  assert.equal((await miners.setRenew(id, 'OP-9999999', true)).status, 404);
});

test('only a Smart Mining miner can renew, and the switch cannot be turned on once the term is over', async () => {
  const id = await account('rules');
  await credit(id, 1);
  const g = await miners.grantPlan(id, { planId: 'custom', th: 15, days: 90 });
  assert.ok(g.ok);
  assert.equal((await miners.setRenew(id, g.contract.serial, true)).status, 409);

  const r = await buy(id);
  await age(id, r.contract.serial, false);
  assert.equal((await miners.setRenew(id, r.contract.serial, true)).status, 409);
  assert.equal((await miners.setRenew(id, r.contract.serial, false)).ok, true, 'it can still be turned off');
  assert.equal((await miners.getMiner(r.contract.serial, id)).renewable, undefined);
});

test('a due miner with the switch on buys the same plan again from the balance, once', async () => {
  const id = await account('go');
  await credit(id, 1);
  const r = await buy(id, { budget: 200, days: 120 });
  assert.ok(r.ok);
  const s = r.contract.serial;
  await age(id, s, true);
  const spent0 = (await getUser(id)).spent || 0;

  const rs = await many(3, () => miners.renewSmart(id, s));
  assert.ok(rs.every((x) => x.ok && x.renewed === true));

  const u = await getUser(id);
  assert.equal(u.contracts.length, 2, 'one new term, not three');
  const [old, next] = u.contracts;
  assert.equal(old.renewedTo, next.serial);
  assert.equal(old.renew, undefined);
  assert.equal(next.renew, true, 'the new term keeps the switch on');
  assert.equal(next.smart, true);
  assert.equal(next.budget, 200);
  assert.equal(next.days, 120);
  assert.ok(Math.abs(next.startedAt - Date.now()) < 120_000);
  assert.ok((u.spent || 0) > spent0, 'the price was taken from the balance');

  const rows = await spendRows(id);
  assert.equal(rows.length, 2);
  assert.equal(Number(rows[1].usd), 200);
  assert.match(rows[1].ref, /\(renewal\)$/);
  assert.equal(u.history.filter((h) => h.kind === 'purchase').length, 2);

  assert.equal(u.notifications.filter((n) => n.title === 'Smart Mining is live').length, 1, 'a renewal does not announce a second purchase');
  const note = u.notifications.find((n) => n.title === 'Smart Mining renewed');
  assert.equal(note.body, `${next.serial} started a new term.`);

  // Asking again changes nothing: the old miner has renewed and never renews twice.
  await miners.renewSmart(id, s);
  assert.equal((await getUser(id)).contracts.length, 2);
});

test('nothing is bought while the term runs, or when the switch is off', async () => {
  const id = await account('idle');
  await credit(id, 1);
  const a = await buy(id);
  assert.ok((await miners.setRenew(id, a.contract.serial, true)).ok);
  const b = await buy(id);
  await age(id, b.contract.serial, false);

  assert.equal((await miners.renewSmart(id, a.contract.serial)).status, 409, 'term still running');
  assert.equal((await miners.renewSmart(id, b.contract.serial)).status, 409, 'switch off');
  await renewDue();
  const u = await getUser(id);
  assert.equal(u.contracts.length, 2);
  assert.equal((await spendRows(id)).length, 2);
});

test('the timer step renews every due miner with the switch on, once', async () => {
  const id = await account('tick');
  await credit(id, 1);
  const r = await buy(id);
  await age(id, r.contract.serial, true);

  assert.ok((await renewDue()) >= 1);
  const u = await getUser(id);
  assert.equal(u.contracts.length, 2);
  assert.equal(u.contracts[0].renewedTo, u.contracts[1].serial);

  await renewDue();
  assert.equal((await getUser(id)).contracts.length, 2, 'a second run changes nothing');
});

test('a short balance or Smart Mining switched off skips the renewal, turns the switch off and tells the user', async () => {
  const short = await account('short');
  await credit(short, 1);
  const a = await buy(short);
  await age(short, a.contract.serial, true);
  await withUser(short, (u) => {
    u.withdrawn = 1e6;
  });
  const spent0 = (await getUser(short)).spent || 0;
  const r = await miners.renewSmart(short, a.contract.serial);
  assert.equal(r.ok, true);
  assert.equal(r.renewed, false);
  const u = await getUser(short);
  assert.equal(u.contracts.length, 1);
  assert.equal(u.contracts[0].renew, undefined);
  assert.equal(u.contracts[0].renewedTo, undefined);
  assert.equal(u.spent || 0, spent0);
  assert.equal(u.notifications[0].title, 'Smart Mining not renewed');
  assert.equal(u.notifications[0].body, 'Your balance did not cover the price.');

  const off = await account('off');
  await credit(off, 1);
  const b = await buy(off);
  await age(off, b.contract.serial, true);
  try {
    assert.equal((await act({ action: 'smart-settings', enabled: false })).ok, true);
    const r2 = await miners.renewSmart(off, b.contract.serial);
    assert.equal(r2.ok, true);
    assert.equal(r2.renewed, false);
  } finally {
    await act({ action: 'smart-settings', enabled: true });
  }
  const v = await getUser(off);
  assert.equal(v.contracts.length, 1);
  assert.equal(v.contracts[0].renew, undefined);
  assert.equal(v.notifications[0].title, 'Smart Mining not renewed');
  assert.equal(v.notifications[0].body, 'Smart Mining is not available right now.');
});

test('the route flips the switch for its owner only, and refuses a bad body', async () => {
  const id = await account('rt');
  const other = await account('rt-x');
  await credit(id, 1);
  const r = await buy(id);
  const s = r.contract.serial;
  const call = async (cookie, body) => {
    const res = await route.POST(
      new NextRequest(`http://app.test/api/miners/${s}`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
      { params: Promise.resolve({ serial: s }) },
    );
    return { status: res.status, body: await res.json() };
  };
  const mine = `${auth.COOKIE}=${await auth.newSession(id)}`;
  const theirs = `${auth.COOKIE}=${await auth.newSession(other)}`;

  const on = await call(mine, { renew: true });
  assert.equal(on.status, 200);
  assert.equal(on.body.renew, true);
  assert.equal((await getUser(id)).contracts[0].renew, true);

  assert.equal((await call(theirs, { renew: false })).status, 404);
  assert.equal((await getUser(id)).contracts[0].renew, true, 'another account cannot change it');
  assert.equal((await call(mine, { renew: 'yes' })).status, 400);
  assert.equal((await call(mine, '{nope')).status, 400);

  assert.equal((await call(mine, { renew: false })).status, 200);
  assert.equal((await getUser(id)).contracts[0].renew, undefined);
});
