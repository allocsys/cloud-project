// The writer of saved days (lib/server/earnlog.js) against a real Postgres.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, q, tx, createUser, getUser, metaSet, friendsOf } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const { saveClosedDays, lastClosed, GRACE, candidateIds } = await import('@/lib/server/earnlog');
const { usdPerDay, dayPrice } = await import('@/lib/earnings');
const { getWallet } = await import('@/lib/server/wallet');
const { getMiners, getMiner } = await import('@/lib/server/miners');

const DAY = 86400000;
const today = Math.floor(Date.now() / DAY) * DAY;
const id = `log${Date.now().toString(36)}@test.dev`;
const serial = `VTX-LOG${Date.now().toString(36)}`;

before(async () => {
  await migrate();
  await q("DELETE FROM meta WHERE key = 'earnlogday'"); // a day gone through by an earlier run on this database
  await tx((c) => createUser(c, id, { cv: 3, contracts: [{ serial, name: 'Log', th: 100, hall: 'tx-1', days: 90, startedAt: today - 6 * DAY, online: true, dailyUsd: 2 }] }));
});
after(async () => {
  await pool().end();
});

test('the newest day to save is yesterday only after the grace time', () => {
  assert.equal(lastClosed(today + GRACE - 1), today - 2 * DAY);
  assert.equal(lastClosed(today + GRACE), today - DAY);
});

test('days are saved once, the balance stays, a later market change moves nothing, and the app never sees the log', async () => {
  const now = today + 12 * 3600000;
  const mined = async () => (await getWallet(id)).history.filter((h) => h.kind === 'payout').map((h) => h.amount);
  const first = await mined();
  assert.ok(first.length >= 5);
  assert.ok((await saveClosedDays(now)) >= 6);
  const c = (await getUser(id)).contracts[0];
  assert.equal(c.logTo, today / DAY - 1);
  assert.equal(Object.keys(c.log).length, 6);
  assert.deepEqual(await mined(), first);
  await saveClosedDays(now);
  assert.deepEqual((await getUser(id)).contracts[0].log, c.log);
  const saved = (await q('SELECT day, btc_usd, gross_per_th FROM market_days WHERE day < $1', [today])).rows;
  await q('UPDATE market_days SET gross_per_th = gross_per_th * 3 WHERE day < $1', [today]);
  try {
    assert.deepEqual(await mined(), first);
  } finally {
    for (const r of saved) await q('UPDATE market_days SET gross_per_th = $2 WHERE day = $1', [r.day, r.gross_per_th]);
  }
  for (const out of [await getMiners(id), await getMiner(serial, id)]) assert.doesNotMatch(JSON.stringify(out), /"log(To|Done)?":/);
});

test('nothing is saved while the guard has not decided the day', async () => {
  const other = `wait-${id}`;
  await tx((c) => createUser(c, other, { cv: 3, contracts: [{ serial: `${serial}-W`, name: 'Wait', th: 1, hall: 'tx-1', days: 90, startedAt: today - 3 * DAY, online: true, dailyUsd: 1 }] }));
  const cur = (await q("SELECT data FROM meta WHERE key = 'guarddays'")).rows[0]?.data || { paused: {}, smart: {} };
  // A day far ahead: nothing can have decided it yet.
  assert.equal(await saveClosedDays(today + 5000 * DAY), 0);
  assert.equal((await getUser(other)).contracts[0].log, undefined);
  await metaSet('guarddays', { ...cur, upto: today - DAY });
});

const mark = async () => (await q("SELECT data FROM meta WHERE key = 'earnlogday'")).rows[0]?.data;
const miner = (n, o = {}) => ({ serial: `${serial}-${n}`, name: n, th: 1, hall: 'tx-1', days: 90, startedAt: today - 3 * DAY, online: true, dailyUsd: 1, ...o });

test('a day is gone through once: later rounds read one row, and only failed accounts come back', async () => {
  const now = today + 12 * 3600000;
  const upto = lastClosed(now);
  const first = await mark();
  assert.equal(first.day, upto);
  assert.deepEqual(first.failed, []);
  const late = `late-${id}`;
  const retry = `retry-${id}`;
  await tx(async (c) => {
    await createUser(c, late, { cv: 3, contracts: [miner('L')] });
    await createUser(c, retry, { cv: 3, contracts: [miner('R')] });
  });
  assert.equal(await saveClosedDays(now), 0, 'nothing is scanned again the same day');
  assert.equal((await getUser(late)).contracts[0].log, undefined);
  await metaSet('earnlogday', { day: upto, failed: [retry] });
  assert.ok((await saveClosedDays(now)) >= 3, 'the failed account is retried');
  assert.ok((await getUser(retry)).contracts[0].log);
  assert.equal((await getUser(late)).contracts[0].log, undefined, 'an account that did not fail is left for the next day');
  assert.deepEqual((await mark()).failed, []);
  assert.equal(await saveClosedDays(now), 0);
});

test('offline miners are never picked, and the saved row is short', async () => {
  const off = `off-${id}`;
  await tx((c) => createUser(c, off, { cv: 3, contracts: [miner('O', { online: false })] }));
  assert.ok(!(await candidateIds(today - DAY)).includes(off));
  assert.ok((await candidateIds(today - DAY)).includes(`late-${id}`));
  const row = Object.values((await getUser(id)).contracts[0].log)[0];
  assert.ok(JSON.stringify(row).length < 60, JSON.stringify(row));
});

test('the invite screen gets the figures the rewards read from the lean friend list', async () => {
  const inviter = `inv-${id}`;
  const friend = `fr-${id}`;
  const d = today / DAY - 2;
  const log = { [d]: [1.5, 85000.25, 2.5, 0.3], [d + 1]: [1.6, 85100.5, 2.6] };
  await tx(async (c) => {
    await createUser(c, inviter, { cv: 3 });
    await createUser(c, friend, { cv: 3, refBy: inviter, contracts: [miner('F', { log, logTo: d + 1 })] });
  });
  const lean = (await friendsOf(inviter))[0].contracts[0];
  const full = (await getUser(friend)).contracts[0];
  const now = Date.now();
  for (const k of [d, d + 1]) {
    assert.equal(usdPerDay(lean, k * DAY, null, now), usdPerDay(full, k * DAY, null, now));
    assert.equal(dayPrice(lean, k * DAY, null, now), dayPrice(full, k * DAY, null, now));
  }
  assert.equal(lean.logTo, full.logTo);
  assert.equal(lean.serial, full.serial);
  assert.equal((await friendsOf(inviter)).length, 1);
});
