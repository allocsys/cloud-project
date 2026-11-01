// Refund requests against a real Postgres: a person asks inside the window, answering the questionnaire; an admin refunds or
// declines. Late asks, granted miners, gifts, other people's miners and repeats are refused. Each test uses its own accounts.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, q, getUser, withUser } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');
const miners = await import('@/lib/server/miners');
const { refundMiner, act } = await import('@/lib/server/admin');
const { createRequest, myRefunds, adminRefunds, decideRefund } = await import('@/lib/server/refund-requests');
const { REFUND_MS } = await import('@/lib/refund-rules');

const run = `q${Date.now().toString(36)}`;
const PW = 'correct horse 1';
const SMALL = { planId: 'custom', th: 15, days: 90 };

async function account(name) {
  const e = `${name}-${run}@test.dev`;
  assert.ok((await auth.signup({ email: e, password: PW })).ok);
  return e;
}
const credit = (id, btc) =>
  withUser(id, (u) => {
    u.withdrawn = (u.withdrawn || 0) - btc;
  });
let seq = 0;
async function buy(id) {
  const r = await miners.buyPlan({ ...SMALL, pay: 'balance' }, { userId: id, key: `${run}-${++seq}` });
  assert.ok(r.ok, r.error);
  return r.contract.serial;
}
const ask = (id, serial, over = {}, now) => createRequest(id, serial, { reason: 'mistake', ...over }, now);

before(async () => {
  await migrate();
});

after(async () => {
  await pool().end();
});

test('a request is saved with its answers and shows as open for that miner', async () => {
  const id = await account('ok');
  await credit(id, 0.01);
  const serial = await buy(id);

  assert.ok((await myRefunds(id)).open[serial], 'a refund can be asked for');
  const r = await ask(id, serial, { reason: 'low', again: 'maybe', note: '  Looked too low  ' });
  assert.ok(r.ok, r.error);

  const mine = await myRefunds(id);
  assert.equal(mine.open[serial], undefined, 'nothing more to ask once it is open');
  assert.equal(mine.requests.length, 1);
  assert.equal(mine.requests[0].status, 'pending');
  assert.equal(mine.requests[0].reason, 'low');
  assert.equal(mine.requests[0].again, 'maybe');
  assert.equal(mine.requests[0].note, 'Looked too low');
  assert.ok((await adminRefunds()).some((x) => x.id === r.id && x.status === 'pending'));
});

test('one open request per miner, and the answers are checked', async () => {
  const id = await account('rules');
  await credit(id, 0.01);
  const serial = await buy(id);

  assert.equal((await ask(id, serial, { reason: 'nope' })).status, 422);
  assert.equal((await ask(id, serial, { again: 'sometimes' })).status, 422);
  assert.equal((await ask(id, serial, { reason: 'other' })).status, 422, 'Other needs a few words');
  assert.equal((await ask(id, serial, { reason: 'other', note: 'x' })).status, 422);
  assert.ok((await ask(id, serial, { reason: 'other', note: 'Changed my mind' })).ok);
  assert.equal((await ask(id, serial)).status, 409, 'already open');
  assert.equal((await myRefunds(id)).requests.length, 1);
});

test('late asks, other people\u2019s miners, gifts and granted miners are refused', async () => {
  const id = await account('late');
  const other = await account('other');
  await credit(id, 0.01);
  const serial = await buy(id);
  const start = (await getUser(id)).contracts[0].startedAt;

  const late = await ask(id, serial, {}, start + REFUND_MS + 3600000);
  assert.equal(late.status, 409);
  assert.match(late.error, /first payout day/);

  assert.equal((await ask(other, serial)).status, 404, 'not their miner');
  assert.equal((await ask(id, 'VTX-0000000')).status, 404);

  const g = await miners.grantPlan(id, SMALL);
  assert.ok(g.ok);
  assert.equal((await ask(id, g.contract.serial)).status, 409, 'granted, not paid for');
  assert.equal((await myRefunds(id)).requests.length, 0);
});

test('refunding a request pays the price back, removes the miner and closes the request', async () => {
  const id = await account('yes');
  await credit(id, 0.01);
  const serial = await buy(id);
  const r = await ask(id, serial, { reason: 'money' });
  assert.ok(r.ok, r.error);

  const d = await decideRefund(id, r.id, 'approve', '', refundMiner);
  assert.ok(d.ok, d.error);
  assert.ok(d.usd > 0);
  assert.equal((await getUser(id)).contracts.length, 0);
  assert.equal((await myRefunds(id)).requests[0].status, 'approved');
  assert.ok((await decideRefund(id, r.id, 'approve', '', refundMiner)).ok, 'the same decision twice is harmless');
  assert.equal((await decideRefund(id, r.id, 'reject', 'x', refundMiner)).status, 409, 'cannot flip a decision');
});

test('declining keeps the miner, tells the person and keeps the note', async () => {
  const id = await account('no');
  await credit(id, 0.01);
  const serial = await buy(id);
  const r = await ask(id, serial, { reason: 'better' });

  const d = await decideRefund(id, r.id, 'reject', 'This miner already started.', refundMiner);
  assert.ok(d.ok, d.error);
  const u = await getUser(id);
  assert.equal(u.contracts.length, 1, 'the miner stays');
  const n = u.notifications.find((x) => x.code === 'refundNo');
  assert.ok(n);
  assert.equal(n.vars.serial, serial);
  assert.match(n.body, /was declined\. This miner already started\./);
  const mine = await myRefunds(id);
  assert.equal(mine.requests[0].status, 'rejected');
  assert.equal(mine.requests[0].answer, 'This miner already started.');
  assert.ok(mine.open[serial], 'while the window is open they may ask again');
});

test('the admin action refunds through the same rules', async () => {
  const id = await account('act');
  await credit(id, 0.01);
  const serial = await buy(id);
  const r = await ask(id, serial);
  assert.equal((await act({ action: 'refund-request', userId: id, id: r.id, decision: 'maybe' })).status, 400);
  const d = await act({ action: 'refund-request', userId: id, id: r.id, decision: 'approve' });
  assert.ok(d.ok, d.error);
  const rows = (await q("SELECT status FROM refund_requests WHERE id = $1", [r.id])).rows;
  assert.equal(rows[0].status, 'approved');
});
