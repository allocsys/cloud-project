// Withdrawal requests and their review, against a real Postgres. Each test uses its own account.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, q, getUser, withUser } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');
const { withdraw } = await import('@/lib/server/wallet');
const { reviewWithdrawal, adminWithdrawals } = await import('@/lib/server/withdrawals');

const run = `w${Date.now().toString(36)}`;
const PW = 'correct horse 1';
const ADDR = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
const many = (n, fn) => Promise.all(Array.from({ length: n }, (_, i) => fn(i)));

async function account(name) {
  const e = `${name}-${run}@test.dev`;
  assert.ok((await auth.signup({ email: e, password: PW })).ok);
  return e;
}
const credit = (id, btc) =>
  withUser(id, (u) => {
    u.withdrawn = (u.withdrawn || 0) - btc;
  });
const ledgerCount = async (id, kind) => (await q('SELECT count(*)::int AS n FROM ledger WHERE user_id = $1 AND kind = $2', [id, kind])).rows[0].n;
const statusOf = async (wid) => (await q('SELECT status FROM withdrawals WHERE id = $1', [wid])).rows[0].status;

// A funded account with one pending withdrawal. Returns the id, the withdrawal id and the balance reserved.
async function pending(name) {
  const id = await account(name);
  await credit(id, 0.005);
  const before = (await getUser(id)).withdrawn;
  const r = await withdraw({ asset: 'btc', net: 'btc', amount: 0.001, address: ADDR }, { userId: id, key: 'k1' });
  assert.ok(r.ok, r.error);
  return { id, wid: r.id, reserved: (await getUser(id)).withdrawn - before };
}

before(async () => {
  await migrate();
});

after(async () => {
  await pool().end();
});

test('a withdrawal is saved as a pending request, not sent', async () => {
  const { id, wid, reserved } = await pending('req');
  assert.ok(reserved > 0);
  assert.equal(await statusOf(wid), 'pending');
  const entry = (await getUser(id)).history.find((h) => h.wid === wid);
  assert.equal(entry.status, 'pending');
  const row = (await adminWithdrawals(500)).find((w) => w.id === wid);
  assert.equal(row.userId, id);
  assert.equal(row.address, ADDR);
});

test('the same withdrawal key twice makes one request', async () => {
  const id = await account('idem');
  await credit(id, 0.005);
  const rs = await many(5, () => withdraw({ asset: 'btc', net: 'btc', amount: 0.001, address: ADDR }, { userId: id, key: 'same' }));
  assert.ok(rs.every((r) => r.ok));
  assert.equal((await q('SELECT count(*)::int AS n FROM withdrawals WHERE user_id = $1', [id])).rows[0].n, 1);
});

test('rejecting many times at once refunds exactly once', async () => {
  const { id, wid, reserved } = await pending('rej');
  const after1 = (await getUser(id)).withdrawn;
  const rs = await many(6, () => reviewWithdrawal(id, wid, 'reject'));
  assert.ok(rs.every((r) => r.ok));
  assert.equal(await statusOf(wid), 'rejected');
  assert.ok(Math.abs((await getUser(id)).withdrawn - (after1 - reserved)) < 1e-9, 'reserved amount came back once');
  assert.equal(await ledgerCount(id, 'withdrawal_refund'), 1);
  assert.equal((await getUser(id)).history.find((h) => h.wid === wid).status, 'rejected');
});

test('approve, then sent needs a transaction id, and a sent withdrawal cannot be failed', async () => {
  const { id, wid } = await pending('flow');
  assert.equal((await reviewWithdrawal(id, wid, 'sent', 'abcdef123456')).status, 409, 'cannot be sent before it is approved');
  assert.ok((await reviewWithdrawal(id, wid, 'approve')).ok);
  assert.ok((await reviewWithdrawal(id, wid, 'approve')).ok, 'approving twice is harmless');
  assert.equal((await reviewWithdrawal(id, wid, 'sent', '')).status, 422);
  assert.ok((await reviewWithdrawal(id, wid, 'sent', 'abcdef123456')).ok);
  assert.equal(await statusOf(wid), 'sent');
  assert.equal((await reviewWithdrawal(id, wid, 'fail')).status, 409);
  assert.equal((await reviewWithdrawal(id, wid, 'reject')).status, 409);
  assert.equal(await ledgerCount(id, 'withdrawal_refund'), 0);
  assert.equal((await q('SELECT data->>\'txid\' AS t FROM withdrawals WHERE id = $1', [wid])).rows[0].t, 'abcdef123456');
});

test('an approved withdrawal that fails is refunded once; reject is not allowed after approval', async () => {
  const { id, wid } = await pending('fail');
  assert.ok((await reviewWithdrawal(id, wid, 'approve')).ok);
  assert.equal((await reviewWithdrawal(id, wid, 'reject')).status, 409);
  const rs = await many(4, () => reviewWithdrawal(id, wid, 'fail'));
  assert.ok(rs.every((r) => r.ok));
  assert.equal(await statusOf(wid), 'failed');
  assert.equal(await ledgerCount(id, 'withdrawal_refund'), 1);
});

test('unknown decision, wrong owner and unknown id are refused', async () => {
  const { id, wid } = await pending('bad');
  const other = await account('other');
  assert.equal((await reviewWithdrawal(id, wid, 'nonsense')).status, 400);
  assert.equal((await reviewWithdrawal(other, wid, 'reject')).status, 404);
  assert.equal((await reviewWithdrawal(id, 'wd_nope', 'reject')).status, 404);
  assert.equal(await statusOf(wid), 'pending');
});
