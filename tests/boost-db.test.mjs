// Boost tickets against a real Postgres: off until the admin turns them on, paid from the balance, the draw is made at purchase and hidden until
// the boost ends, boosts run side by side up to the cap, a finished boost pays once (balance, ledger, activity), and a double tap buys once.
// Settings changed here are put back in the after hook, so other test files see the defaults (tickets off).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, q, getUser, withUser } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');
const boost = await import('@/lib/server/boost');
const { availableIn } = await import('@/lib/server/wallet');
const { act } = await import('@/lib/server/admin');

const run = `b${Date.now().toString(36)}`;
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
const balance = (id) => withUser(id, (u, c) => availableIn(c, u));
const chances = (extra = {}) => act({ action: 'boost-settings', enabled: true, chance: { t1: 5, t10: 5, t100: 5 }, ...extra });
const ledgerRows = async (id, kind) => (await q('SELECT btc, usd, ref FROM ledger WHERE user_id = $1 AND kind = $2 ORDER BY id', [id, kind])).rows;
// Moves a boost's end into the past, as if the two hours had gone by.
const finish = (id, boostId) =>
  withUser(id, (u) => {
    const b = u.boosts.find((x) => x.id === boostId);
    b.startAt -= 3 * 3600_000;
    b.endsAt -= 3 * 3600_000;
  });

before(async () => {
  await migrate();
});

after(async () => {
  await act({ action: 'boost-settings', enabled: false, chance: { t1: 5, t10: 5, t100: 5 }, shown: { t1: '', t10: '', t100: '' } });
  await pool().end();
});

test('tickets are refused while they are off', async () => {
  assert.equal((await act({ action: 'boost-settings', enabled: false })).ok, true);
  const id = await account('off');
  await credit(id, 1);
  const r = await boost.buyBoost({ ticket: 't1' }, { userId: id });
  assert.equal(r.status, 409);
  assert.equal((await boost.getBoosts(id)).enabled, false);
});

test('a ticket is paid from the balance, starts a two hour boost and hides the draw until it ends', async () => {
  assert.equal((await chances()).ok, true);
  const id = await account('buy');
  const before = await (async () => { await credit(id, 1); return balance(id); })();
  const r = await boost.buyBoost({ ticket: 't10' }, { userId: id });
  assert.equal(r.ok, true);
  assert.equal(r.boost.th, 1200);
  assert.equal(r.boost.endsAt - r.boost.startAt, 2 * 3600_000);
  assert.equal(r.boost.done, false);
  assert.equal('win' in r.boost, false, 'the result is not shown while it runs');
  assert.ok(before - (await balance(id)) > 0);
  const spend = await ledgerRows(id, 'spend');
  assert.equal(spend.length, 1);
  assert.equal(Number(spend[0].usd), 10);
  const v = await boost.getBoosts(id);
  assert.equal(v.running.length, 1);
  assert.equal('win' in v.running[0], false);
  assert.equal(v.tickets.find((t) => t.id === 't10').active, 1);
  assert.equal(v.finished.length, 0);
  assert.equal((await getUser(id)).notifications[0].title, 'Boost started');
});

test('not enough balance and unknown tickets are refused', async () => {
  assert.equal((await chances()).ok, true);
  const id = await account('poor');
  assert.equal((await boost.buyBoost({ ticket: 't1' }, { userId: id })).status, 409);
  assert.equal((await boost.buyBoost({ ticket: 't7' }, { userId: id })).status, 400);
  assert.equal((await getUser(id)).boosts, undefined);
});

test('boosts run side by side up to the cap of each ticket', async () => {
  assert.equal((await chances()).ok, true);
  const id = await account('cap');
  await credit(id, 1);
  for (let i = 0; i < 10; i += 1) assert.equal((await boost.buyBoost({ ticket: 't1' }, { userId: id })).ok, true);
  const r = await boost.buyBoost({ ticket: 't1' }, { userId: id });
  assert.equal(r.status, 409);
  assert.equal((await boost.buyBoost({ ticket: 't10' }, { userId: id })).ok, true, 'another ticket has its own cap');
  const v = await boost.getBoosts(id);
  assert.equal(v.running.length, 11);
  assert.ok(v.running.every((b, i, a) => i === 0 || a[i - 1].startAt <= b.startAt), 'oldest first');
});

test('a double tap with the same key buys once', async () => {
  assert.equal((await chances()).ok, true);
  const id = await account('idem');
  await credit(id, 1);
  const [a, b] = await Promise.all([boost.buyBoost({ ticket: 't1' }, { userId: id, key: 'k1' }), boost.buyBoost({ ticket: 't1' }, { userId: id, key: 'k1' })]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(a.boost.id, b.boost.id);
  assert.equal((await getUser(id)).boosts.length, 1);
  assert.equal((await ledgerRows(id, 'spend')).length, 1);
});

test('a lost draw pays the boost only; the result shows once it ended and settles once', async () => {
  assert.equal((await chances({ chance: { t1: 0 } })).ok, true);
  const id = await account('lose');
  await credit(id, 1);
  const r = await boost.buyBoost({ ticket: 't1' }, { userId: id });
  assert.equal(r.ok, true);
  const afterBuy = await balance(id);
  await finish(id, r.boost.id);
  const gain = (await balance(id)) - afterBuy;
  assert.ok(Math.abs(gain - 0.21 / (await getUser(id)).boosts[0].rate) < 1e-7, 'the boost pay reaches the balance');
  const v = await boost.getBoosts(id);
  assert.equal(v.running.length, 0);
  assert.equal(v.finished[0].done, true);
  assert.equal(v.finished[0].win, false);
  assert.equal((await ledgerRows(id, 'boost-pay')).length, 1);
  assert.equal((await ledgerRows(id, 'boost-prize')).length, 0);
  await Promise.all([boost.settleBoosts(id), boost.settleBoosts(id), boost.settleDue()]);
  assert.equal((await ledgerRows(id, 'boost-pay')).length, 1, 'settled once');
  const u = await getUser(id);
  assert.equal(u.notifications.filter((n) => n.title === 'Boost finished').length, 1);
  assert.equal(u.history.filter((h) => h.kind === 'boost').length, 1);
});

test('a won draw adds the prize on top of the boost pay, with its own ledger row', async () => {
  assert.equal((await chances({ chance: { t1: 100 }, confirm: true })).ok, true);
  const id = await account('win');
  await credit(id, 1);
  const r = await boost.buyBoost({ ticket: 't1' }, { userId: id });
  assert.equal(r.ok, true);
  const afterBuy = await balance(id);
  await finish(id, r.boost.id);
  const rate = (await getUser(id)).boosts[0].rate;
  assert.ok(Math.abs((await balance(id)) - afterBuy - 10.21 / rate) < 1e-7);
  const v = await boost.getBoosts(id);
  assert.equal(v.finished[0].win, true);
  assert.equal((await ledgerRows(id, 'boost-prize')).length, 1);
  assert.equal(Number((await ledgerRows(id, 'boost-prize'))[0].usd), 10);
  assert.match((await getUser(id)).notifications[0].body, /\$10/);
});

test('a later change of the chance does not touch a running boost', async () => {
  assert.equal((await chances({ chance: { t1: 100 }, confirm: true })).ok, true);
  const id = await account('fixed');
  await credit(id, 1);
  const r = await boost.buyBoost({ ticket: 't1' }, { userId: id });
  assert.equal(r.boost.chance, 100);
  assert.equal((await chances({ chance: { t1: 0 } })).ok, true);
  const u = await getUser(id);
  assert.equal(u.boosts[0].chance, 100);
  assert.equal(u.boosts[0].win, true);
});

test('users see the shown chance while the draw uses the real one; empty shown means the real one', async () => {
  const clear = { t1: '', t10: '', t100: '' };
  try {
    assert.equal((await chances({ chance: { t1: 100 }, shown: { t1: 5 }, confirm: true })).ok, true);
    const id = await account('shown');
    await credit(id, 1);
    const r = await boost.buyBoost({ ticket: 't1' }, { userId: id });
    assert.equal(r.ok, true);
    assert.equal(r.boost.chance, 5, 'the buyer is told the shown chance');
    assert.equal((await boost.getBoosts(id)).tickets.find((t) => t.id === 't1').chance, 5);
    assert.equal((await boost.getBoosts(id)).running[0].chance, 5);
    const u = await getUser(id);
    assert.equal(u.boosts[0].chance, 100, 'the real chance is kept on the boost');
    assert.equal(u.boosts[0].win, true, 'the draw used the real chance');
    assert.equal((await act({ action: 'boost-settings', shown: { t1: 120 } })).status, 422);
    assert.equal((await act({ action: 'boost-settings', shown: clear })).ok, true);
    assert.equal((await boost.getBoosts(id)).tickets.find((t) => t.id === 't1').chance, 100, 'empty shows the real chance');
  } finally {
    await act({ action: 'boost-settings', enabled: true, chance: { t1: 5, t10: 5, t100: 5 }, shown: clear });
  }
});

test('the admin settings: a chance that loses money needs a second confirm, bad numbers are refused, the switch flips on its own', async () => {
  assert.equal((await chances()).ok, true);
  const refused = await act({ action: 'boost-settings', chance: { t1: 20 } });
  assert.equal(refused.ok, false);
  assert.equal(refused.status, 409);
  assert.equal(refused.needConfirm, true);
  assert.equal((await boost.boostSettings()).chance.t1, 5, 'nothing was saved');
  const ok = await act({ action: 'boost-settings', chance: { t1: 20 }, confirm: true });
  assert.equal(ok.ok, true);
  assert.equal(ok.settings.chance.t1, 20);
  assert.equal((await act({ action: 'boost-settings', chance: { t10: 120 } })).status, 422);
  assert.equal((await act({ action: 'boost-settings', chance: { t10: 'x' } })).status, 422);
  const off = await act({ action: 'boost-settings', enabled: false });
  assert.equal(off.ok, true);
  assert.equal(off.settings.enabled, false);
  assert.equal(off.settings.chance.t1, 20, 'the rest stays as it was');
  assert.equal((await act({ action: 'boost-settings', chance: { t1: 5 } })).ok, true);
});
