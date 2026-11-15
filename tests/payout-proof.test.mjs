// The public payout proof (lib/server/network-stats.js payoutProof), against a real Postgres.
// Only withdrawals marked 'sent' count, and the answer carries no user id, address or transaction id.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, q, withUser } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');
const { withdraw } = await import('@/lib/server/wallet');
const { reviewWithdrawal } = await import('@/lib/server/withdrawals');
const { payoutProof } = await import('@/lib/server/network-stats');

const run = `p${Date.now().toString(36)}`;
const PW = 'correct horse 1';
const ADDR = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
const TX = 'proofTx123456';

before(async () => {
  await migrate();
});

after(async () => {
  await pool().end();
});

test('only sent withdrawals count, and nothing private is returned', async () => {
  const email = `proof-${run}@test.dev`;
  assert.ok((await auth.signup({ email, password: PW })).ok);
  await withUser(email, (u) => {
    u.withdrawn = (u.withdrawn || 0) - 0.005;
  });
  const r = await withdraw({ asset: 'btc', net: 'btc', amount: 0.001, address: ADDR }, { userId: email, key: 'proof1' });
  assert.ok(r.ok, r.error);

  const before0 = await payoutProof();
  assert.ok(before0 && before0.count >= 0);

  assert.ok((await reviewWithdrawal(email, r.id, 'approve')).ok);
  const approved = await payoutProof();
  assert.equal(approved.count, before0.count, 'pending and approved do not count');

  assert.ok((await reviewWithdrawal(email, r.id, 'sent', TX)).ok);
  const after1 = await payoutProof();
  assert.equal(after1.count, before0.count + 1);
  assert.ok(after1.btc > before0.btc);
  assert.ok(after1.hours !== null && after1.hours >= 0);
  assert.ok(after1.last.length >= 1 && after1.last.length <= 10);
  assert.ok(after1.last.every((w) => w.asset && Number.isFinite(w.at)));

  const text = JSON.stringify(after1);
  assert.ok(!text.includes(ADDR), 'no address');
  assert.ok(!text.includes(TX), 'no transaction id');
  assert.ok(!text.includes(email), 'no user id');
  await q('SELECT 1');
});
