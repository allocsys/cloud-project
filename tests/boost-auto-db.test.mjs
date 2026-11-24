// Boost auto buy against a real Postgres: off until the admin allows it, validated, bought once a day at the user's own random moment, skipped
// (and told) when the balance is short, never twice in a day even with two rounds at once, and nothing happens while it is switched off.
// Settings changed here are put back in the after hook, so other test files see the defaults (tickets off, auto buy off).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, q, getUser, withUser } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const auth = await import('@/lib/server/auth');
const boost = await import('@/lib/server/boost');
const { AUTO } = await import('@/lib/boost');
const { act } = await import('@/lib/server/admin');

const run = `ab${Date.now().toString(36)}`;
const PW = 'correct horse 1';
const DAY = 86_400_000;
const today = () => Math.floor(Date.now() / DAY);

async function account(name) {
  const e = `${name}-${run}@test.dev`.toLowerCase(); // signup lowercases emails
  assert.ok((await auth.signup({ email: e, password: PW })).ok);
  return e;
}
const credit = (id, btc) =>
  withUser(id, (u) => {
    u.withdrawn = (u.withdrawn || 0) - btc;
  });
const ledgerRows = async (id, kind) => (await q('SELECT usd FROM ledger WHERE user_id = $1 AND kind = $2 ORDER BY id', [id, kind])).rows;
const settings = (extra = {}) => act({ action: 'boost-settings', enabled: true, chance: { t1: 5, t10: 5, t100: 5 }, auto: { on: true }, ...extra });
// Makes the account's auto buy due now, as if its random moment had come.
const due = (id, extra = {}) =>
  withUser(id, (u) => {
    u.autoBoost = { ...u.autoBoost, nextAt: Date.now() - 1000, ...extra };
  });
// The part of a moment inside its UTC day.
const inDay = (ms) => ms - Math.floor(ms / DAY) * DAY;

before(async () => {
  await migrate();
});

after(async () => {
  await act({ action: 'boost-settings', enabled: false, chance: { t1: 5, t10: 5, t100: 5 }, auto: { on: false } });
  await pool().end();
});

test('auto buy is refused and hidden until the admin switches it on', async () => {
  assert.equal((await act({ action: 'boost-settings', enabled: true, chance: { t1: 5, t10: 5, t100: 5 }, auto: { on: false } })).ok, true);
  const id = await account('off');
  assert.equal((await boost.getBoosts(id)).auto.available, false);
  assert.equal((await boost.setAutoBoost({ on: true, qty: 2 }, { userId: id })).status, 409);
  assert.equal((await getUser(id)).autoBoost, undefined);
  assert.equal((await settings()).ok, true);
  const v = await boost.getBoosts(id);
  assert.equal(v.auto.available, true);
  assert.equal(v.auto.on, false);
  assert.equal(v.auto.max, AUTO.maxQty);
});

test('turning it on needs a whole amount from 1 to the maximum; turning it off keeps the amount and clears the schedule', async () => {
  assert.equal((await settings()).ok, true);
  const id = await account('qty');
  for (const bad of [0, 6, 1.5, -1, 'x', undefined]) assert.equal((await boost.setAutoBoost({ on: true, qty: bad }, { userId: id })).status, 400, `qty ${bad}`);
  assert.equal((await getUser(id)).autoBoost, undefined, 'nothing saved');
  const on = await boost.setAutoBoost({ on: true, qty: 3 }, { userId: id });
  assert.equal(on.ok, true);
  assert.deepEqual(on.auto, { available: true, on: true, qty: 3, max: AUTO.maxQty });
  const a = (await getUser(id)).autoBoost;
  assert.equal(a.on, true);
  assert.equal(a.qty, 3);
  assert.ok(a.nextAt > Date.now(), 'the first buy is still to come');
  assert.ok(a.nextAt < Date.now() + 2 * DAY);
  const off = await boost.setAutoBoost({ on: false }, { userId: id });
  assert.equal(off.ok, true);
  assert.equal(off.auto.on, false);
  assert.equal(off.auto.qty, 3, 'the amount is kept');
  assert.equal((await getUser(id)).autoBoost.nextAt, null);
});

test('a due account gets its tickets once, paid like a normal buy, and the next buy is a random moment tomorrow', async () => {
  assert.equal((await settings()).ok, true);
  const id = await account('buy');
  await credit(id, 1);
  assert.equal((await boost.setAutoBoost({ on: true, qty: 3 }, { userId: id })).ok, true);
  assert.equal(await boost.autoBuyDue(), 0, 'not due yet: nothing bought');
  assert.equal((await getUser(id)).boosts, undefined);
  await due(id);
  assert.equal(await boost.autoBuyDue(), 3);
  const u = await getUser(id);
  assert.equal(u.boosts.length, 3);
  assert.ok(u.boosts.every((b) => b.price === 1 && b.t === 't1'));
  assert.equal((await ledgerRows(id, 'spend')).length, 3);
  assert.equal(u.autoBoost.lastDay, today());
  assert.ok(u.autoBoost.nextAt >= (today() + 1) * DAY + AUTO.from && u.autoBoost.nextAt <= (today() + 1) * DAY + AUTO.to, 'tomorrow, inside the window');
  const note = u.notifications.find((n) => n.code === 'boostAuto');
  assert.ok(note, 'told with the auto text');
  assert.equal(note.vars.q, 3);
  assert.equal(u.notifications.some((n) => n.code === 'boost'), false, 'not also the plain one');
  assert.equal(await boost.autoBuyDue(), 0, 'a second round the same day buys nothing');
  assert.equal((await getUser(id)).boosts.length, 3);
});

test('never twice in one day: an old moment on a day already tried only moves the schedule', async () => {
  assert.equal((await settings()).ok, true);
  const id = await account('twice');
  await credit(id, 1);
  assert.equal((await boost.setAutoBoost({ on: true, qty: 1 }, { userId: id })).ok, true);
  await due(id);
  assert.equal(await boost.autoBuyDue(), 1);
  await due(id); // due again, but today was already done
  assert.equal(await boost.autoBuyDue(), 0);
  assert.equal((await getUser(id)).boosts.length, 1);
  assert.ok((await getUser(id)).autoBoost.nextAt > Date.now(), 'moved on');
});

test('two rounds at once buy once', async () => {
  assert.equal((await settings()).ok, true);
  const id = await account('race');
  await credit(id, 1);
  assert.equal((await boost.setAutoBoost({ on: true, qty: 2 }, { userId: id })).ok, true);
  await due(id);
  await Promise.all([boost.autoBuyDue(), boost.autoBuyDue()]);
  assert.equal((await getUser(id)).boosts.length, 2);
  assert.equal((await ledgerRows(id, 'spend')).length, 2);
});

test('a short balance skips the day, tells the user and tries again tomorrow', async () => {
  assert.equal((await settings()).ok, true);
  const id = await account('poor');
  assert.equal((await boost.setAutoBoost({ on: true, qty: 2 }, { userId: id })).ok, true);
  await due(id);
  assert.equal(await boost.autoBuyDue(), 0);
  const u = await getUser(id);
  assert.equal(u.boosts, undefined, 'nothing bought, not even in part');
  assert.equal(u.autoBoost.on, true, 'still on');
  assert.equal(u.autoBoost.lastDay, today());
  assert.ok(u.autoBoost.nextAt >= (today() + 1) * DAY, 'tomorrow');
  assert.equal(u.notifications.filter((n) => n.code === 'boostAutoSkip').length, 1);
  assert.equal((await ledgerRows(id, 'spend')).length, 0);
});

test('a full running limit skips too, and nothing is bought in part', async () => {
  assert.equal((await settings()).ok, true);
  const id = await account('full');
  await credit(id, 1);
  assert.equal((await boost.buyBoost({ ticket: 't1', qty: 5 }, { userId: id })).ok, true);
  assert.equal((await boost.buyBoost({ ticket: 't1', qty: 4 }, { userId: id })).ok, true);
  assert.equal((await boost.setAutoBoost({ on: true, qty: 3 }, { userId: id })).ok, true);
  await due(id);
  assert.equal(await boost.autoBuyDue(), 0, '9 running + 3 is over the cap of 10');
  const u = await getUser(id);
  assert.equal(u.boosts.length, 9);
  assert.equal(u.notifications.filter((n) => n.code === 'boostAutoSkip').length, 1);
});

test('nothing is bought while tickets or auto buy are off, and a user who turned it off is left alone', async () => {
  assert.equal((await settings()).ok, true);
  const a = await account('swoff');
  const b = await account('userOff');
  for (const id of [a, b]) {
    await credit(id, 1);
    assert.equal((await boost.setAutoBoost({ on: true, qty: 1 }, { userId: id })).ok, true);
    await due(id);
  }
  assert.equal((await boost.setAutoBoost({ on: false }, { userId: b })).ok, true);
  assert.equal((await act({ action: 'boost-settings', auto: { on: false } })).ok, true);
  assert.equal(await boost.autoBuyDue(), 0, 'admin switch off');
  assert.equal((await getUser(a)).boosts, undefined);
  assert.equal((await settings()).ok, true);
  assert.equal((await act({ action: 'boost-settings', enabled: false })).ok, true);
  assert.equal(await boost.autoBuyDue(), 0, 'tickets off');
  assert.equal((await getUser(a)).boosts, undefined);
  assert.equal((await settings()).ok, true);
  assert.equal(await boost.autoBuyDue(), 1, 'back on: the one still on is bought');
  assert.equal((await getUser(a)).boosts.length, 1);
  assert.equal((await getUser(b)).boosts, undefined, 'the one switched off is never bought');
});

test('the first buy lands a few minutes to a few hours after switching on, the same day, or tomorrow when that is over', async () => {
  assert.equal((await settings()).ok, true);
  const id = await account('first');
  const t0 = Date.now();
  assert.equal((await boost.setAutoBoost({ on: true, qty: 1 }, { userId: id })).ok, true);
  const next = (await getUser(id)).autoBoost.nextAt;
  const sameDay = Math.floor(next / DAY) === Math.floor(t0 / DAY);
  if (sameDay) assert.ok(next >= t0 + AUTO.firstMin && next <= Date.now() + AUTO.firstMax);
  else assert.ok(inDay(next) >= AUTO.from && inDay(next) <= AUTO.to, 'tomorrow, inside the window');
  // Changing the amount while on keeps the moment; off then on again the same day never gets a second buy today.
  assert.equal((await boost.setAutoBoost({ on: true, qty: 4 }, { userId: id }).then((r) => r.auto.qty)), 4);
  assert.equal((await getUser(id)).autoBoost.nextAt, next, 'same moment');
  await credit(id, 1);
  await due(id);
  assert.equal(await boost.autoBuyDue(), 4);
  assert.equal((await boost.setAutoBoost({ on: false }, { userId: id })).ok, true);
  assert.equal((await boost.setAutoBoost({ on: true, qty: 4 }, { userId: id })).ok, true);
  assert.ok((await getUser(id)).autoBoost.nextAt >= (today() + 1) * DAY, 'today was already done: tomorrow');
});

test('the random moments spread over the day', async () => {
  assert.equal((await settings()).ok, true);
  const ids = [];
  for (let i = 0; i < 12; i += 1) ids.push(await account(`spread${i}`));
  for (const id of ids) await credit(id, 1);
  const moments = new Set();
  for (const id of ids) {
    assert.equal((await boost.setAutoBoost({ on: true, qty: 1 }, { userId: id }).then((r) => r.ok)), true);
    await due(id);
  }
  await boost.autoBuyDue();
  for (const id of ids) {
    const a = (await getUser(id)).autoBoost;
    assert.ok(inDay(a.nextAt) >= AUTO.from && inDay(a.nextAt) <= AUTO.to);
    moments.add(Math.floor(inDay(a.nextAt) / 600_000)); // 10 minute windows, the timer's own step
  }
  assert.ok(moments.size >= 6, `the buys are not stacked on a few moments (${moments.size} windows for 12 users)`);
});
