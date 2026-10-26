// Admin "Make it win" on a running boost, against a real Postgres: a running boost that was a loss turns into a win and pays the prize once
// it ends, a boost that already wins or has ended is refused, and the admin overview lists running boosts only.
// Settings changed here are put back in the after hook, so other test files see the defaults (tickets off).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, q, getUser, withUser } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');
const boost = await import('@/lib/server/boost');
const { act, overview } = await import('@/lib/server/admin');

const run = `w${Date.now().toString(36)}`;
const PW = 'correct horse 1';

async function account(name) {
  const e = `${name}-${run}@test.dev`;
  assert.ok((await auth.signup({ email: e, password: PW })).ok);
  return e;
}
const credit = (id, btc) =>
  withUser(id, (u) => {
    u.withdrawn = (u.withdrawn || 0) - btc;
  });
const ledgerRows = async (id, kind) => (await q('SELECT btc, usd, ref FROM ledger WHERE user_id = $1 AND kind = $2 ORDER BY id', [id, kind])).rows;
const finish = (id, boostId) =>
  withUser(id, (u) => {
    const b = u.boosts.find((x) => x.id === boostId);
    b.startAt -= 3 * 3600_000;
    b.endsAt -= 3 * 3600_000;
  });
const losing = () => act({ action: 'boost-settings', enabled: true, chance: { t1: 0, t10: 0, t100: 0 } });

before(async () => {
  await migrate();
});

after(async () => {
  await act({ action: 'boost-settings', enabled: false, chance: { t1: 5, t10: 5, t100: 5 }, shown: { t1: '', t10: '', t100: '' } });
  await pool().end();
});

test('a running boost that lost can be set to win, and the prize is paid once when it ends', async () => {
  assert.equal((await losing()).ok, true);
  const id = await account('gift');
  await credit(id, 1);
  const r = await boost.buyBoost({ ticket: 't1' }, { userId: id });
  assert.equal(r.ok, true);
  assert.equal((await getUser(id)).boosts[0].win, false);

  const seen = (await overview()).boosts.find((b) => b.id === r.boost.id);
  assert.equal(seen.userId, id);
  assert.equal(seen.win, false);

  const w = await act({ action: 'boost-win', userId: id, id: r.boost.id });
  assert.equal(w.ok, true);
  const b = (await getUser(id)).boosts[0];
  assert.equal(b.win, true);
  assert.equal(b.forced, true);
  assert.equal('win' in (await boost.getBoosts(id)).running[0], false, 'the user still sees nothing until it ends');

  await finish(id, r.boost.id);
  const v = await boost.getBoosts(id);
  assert.equal(v.finished[0].win, true);
  assert.equal((await ledgerRows(id, 'boost-prize')).length, 1);
  await boost.settleBoosts(id);
  assert.equal((await ledgerRows(id, 'boost-prize')).length, 1, 'paid once');
});

test('a boost that already wins, one that has ended and an unknown one are refused', async () => {
  assert.equal((await act({ action: 'boost-settings', enabled: true, chance: { t1: 100, t10: 100, t100: 100 }, confirm: true })).ok, true);
  const id = await account('again');
  await credit(id, 1);
  const r = await boost.buyBoost({ ticket: 't1' }, { userId: id });
  assert.equal(r.ok, true);
  assert.equal((await act({ action: 'boost-win', userId: id, id: r.boost.id })).status, 409, 'already wins');
  assert.equal((await act({ action: 'boost-win', userId: id, id: 'bst_nope' })).status, 404);
  await finish(id, r.boost.id);
  assert.equal((await act({ action: 'boost-win', userId: id, id: r.boost.id })).status, 409, 'already ended');
  assert.equal((await overview()).boosts.some((b) => b.id === r.boost.id), false, 'ended boosts are not listed');
});
