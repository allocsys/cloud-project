// The profit guard's daily decisions against a real Postgres: written once per finished day from that day's final market,
// never backwards in time on the first run, locked once written, switchable per scope, and the owners are told what changed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, q, tx, createUser, getUser, metaGet, metaSet, metaDelete } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const { ensureGuardDays, guardState, guardOverview, guardBacktest, saveGuardSettings, setGuardManual } = await import('@/lib/server/guard');
const { isPaused } = await import('@/lib/guard');

// The Smart scopes the default pay table gives for the admin card: the middle of the table plus each term's bonus, so the shortest term
// is 90 days at 0.305% and the longest 180 days at 0.335%.
const FIRST = 'smart:90:305';
const LAST = 'smart:180:335';

const DAY = 86400000;
const today = Math.floor(Date.now() / DAY) * DAY;
const d = (k) => today - k * DAY;
const ID = 'guarduser@test';
const wipe = async () => {
  await q('DELETE FROM market_days');
  await q('DELETE FROM coin_days');
  await q('DELETE FROM users WHERE id = $1', [ID]);
  await metaDelete('guard');
  await metaDelete('guarddays');
};
const market = (day, gross) => q('INSERT INTO market_days (day, btc_usd, difficulty, gross_per_th, at) VALUES ($1, 100000, 1, $2, $3)', [day, String(gross), day + 1000]);
// A Smart day is a net profit per reference rig; with the anchor set to 1 below, the value is the ratio.
const coin = (day, ratio) => q("INSERT INTO coin_days (day, coin, price_usd, gross_per_unit, net_per_rig, at) VALUES ($1, 'BTC', 1, $2, $2, $3)", [day, String(ratio), day + 1000]);

const autoLog = async () => (((await q("SELECT data FROM meta WHERE key = 'adminlog'")).rows[0]?.data) || []).filter((e) => e.action === 'guard-auto');

before(async () => {
  await migrate();
  await wipe();
  await q("UPDATE smart_coins SET ref_gross = 1, ref_net = 1 WHERE symbol IN ('BTC', 'KAS', 'RVN', 'XMR')");
  await tx(async (c) =>
    createUser(c, ID, { contracts: [{ serial: 'VTX-9000001', name: 'Guard test', plan: 'Custom', th: 10, hall: 'tx-1', online: true, days: 90, startedAt: d(10), dailyUsd: 1, price: 100, status: 'active' }] }),
  );
});

after(async () => {
  await wipe();
  await pool().end();
});

test('the first run decides nothing: it starts at yesterday', async () => {
  assert.equal(await ensureGuardDays(Date.now()), 0);
  assert.equal(metaGet('guarddays').upto, today - DAY);
  assert.deepEqual(metaGet('guarddays').paused, {});
});

test('losing days are paused for every hall, Smart is kept per plan, a good day is not paused, and the owner is told it resumed', async () => {
  await metaSet('guarddays', { upto: d(4), paused: {} });
  const had = (await autoLog()).length;
  await market(d(3), 0.0001); // far below any hall's costs
  await market(d(2), 0.0001);
  await market(d(1), 1); // far above
  await coin(d(3), 0.3); // under the Smart floor (0.5)
  await coin(d(2), 0.3);
  await coin(d(1), 2);
  assert.equal(await ensureGuardDays(Date.now()), 3);
  const g = metaGet('guarddays');
  assert.equal(g.upto, d(1));
  assert.deepEqual([...g.paused[d(3)]].sort(), ['is-2', 'no-1', 'tx-1']);
  assert.deepEqual([...g.paused[d(2)]].sort(), ['is-2', 'no-1', 'tx-1']);
  assert.equal(g.paused[d(1)], undefined, 'a profitable day pauses nothing');
  assert.deepEqual(g.smart[d(3)], [0.3, 0.5, 0.02, 1], 'Smart keeps the day\'s best ratio with the rule in force');
  assert.deepEqual(g.smart[d(2)], [0.3, 0.5, 0.02, 1]);
  assert.deepEqual(g.smart[d(1)], [2, 0.5, 0.02, 1]);
  const s = await guardState();
  for (const scope of [FIRST, LAST]) {
    assert.equal(isPaused(s, scope, d(3)), true, `${scope} is below its break-even`);
    assert.equal(isPaused(s, scope, d(2)), true);
    assert.equal(isPaused(s, scope, d(1)), false, `${scope} resumes on a good day`);
  }
  const u = await getUser(ID);
  assert.ok(u.notifications.some((n) => n.title === 'Mining resumed'), 'the owner of a tx-1 miner hears it is back');
  const log = await autoLog();
  assert.equal(log.length, had + 2, 'one entry for the day it paused and one for the day it resumed');
  assert.match(log[0].detail, /resumed/);
  assert.match(log[1].detail, /paused .*Smart Mining/);
});

test('a decided day is locked, and a second run does nothing', async () => {
  const before = JSON.stringify(metaGet('guarddays'));
  await q('UPDATE market_days SET gross_per_th = 1');
  assert.equal(await ensureGuardDays(Date.now()), 0);
  assert.equal(JSON.stringify(metaGet('guarddays')), before);
  const s = await guardState();
  assert.ok(s.paused[d(3)].includes('tx-1'));
  assert.deepEqual(s.smart[d(3)], [0.3, 0.5, 0.02, 1]);
});

test('switching a scope off stops new pauses for it, and hand flips are saved by scope', async () => {
  await metaSet('guarddays', { upto: d(2), paused: {} });
  await q('UPDATE market_days SET gross_per_th = 0.0001 WHERE day = $1', [d(1)]);
  await q('UPDATE coin_days SET gross_per_unit = 0.3, net_per_rig = 0.3 WHERE day = $1', [d(1)]);
  assert.equal((await saveGuardSettings({ asicsAuto: false, smartAuto: true, mode: 'zero', margin: 0, buffer: 2 })).ok, true);
  assert.equal(await ensureGuardDays(Date.now()), 1);
  assert.equal(metaGet('guarddays').paused[d(1)], undefined, 'ASICs auto is off');
  assert.deepEqual(metaGet('guarddays').smart[d(1)], [0.3, 0.5, 0.02, 1], 'Smart is still guarded: its ratio is kept');
  assert.equal((await setGuardManual({ scope: 'tx-1', state: 'paused', when: 'now' })).ok, true);
  assert.equal((await setGuardManual({ scope: 'nope', state: 'paused' })).ok, false);
  assert.equal((await setGuardManual({ scope: 'tx-1', state: 'maybe' })).ok, false);
  const s = await guardState();
  assert.deepEqual(s.manual['tx-1'], [{ from: today, state: 'paused' }]);
});

test('settings are checked: margin, buffer and the Smart floor have limits', async () => {
  assert.equal((await saveGuardSettings({ margin: 80, buffer: 1 })).ok, false);
  assert.equal((await saveGuardSettings({ margin: 1, buffer: 1, smartFloor: 5 })).ok, false);
  assert.equal((await saveGuardSettings({ margin: 1, buffer: 1, smartFloor: 'abc' })).ok, false);
  const f = await saveGuardSettings({ margin: 0, buffer: 2, smartFloor: '0,6' });
  assert.equal(f.ok, true);
  assert.equal(f.smartFloor, 0.6);
  assert.equal(metaGet('guard').smartFloor, 0.6);
  assert.equal((await saveGuardSettings({ margin: 0, buffer: 2 })).smartFloor, 0.6, 'a save that leaves the floor out keeps it');
  assert.equal((await saveGuardSettings({ margin: 0, buffer: 2, smartFloor: 0.5 })).smartFloor, 0.5);
  assert.equal((await saveGuardSettings({ margin: 1, buffer: 50 })).ok, false);
  const r = await saveGuardSettings({ margin: '2,5', buffer: 1, mode: 'extend' });
  assert.equal(r.ok, true);
  assert.equal(r.margin, 0.025);
  assert.equal(r.mode, 'extend');
  assert.ok(Array.isArray(metaGet('guard').manual?.['tx-1']), 'saving the rules keeps the hand flips');
});

test('the admin overview lists each scope\'s paused days of the last 14, newest first, by rule and by hand', async () => {
  // tx-1 is paused by hand from today (set above); the first Smart plan was paused by the rule yesterday; no-1 has one day inside
  // the window (13 days ago) and one just outside it (14 days ago).
  await metaSet('guarddays', { upto: d(1), paused: { [d(13)]: ['no-1'], [d(14)]: ['no-1'] }, smart: { [d(1)]: [0.5, 0, 0.02] } });
  const o = await guardOverview();
  const by = Object.fromEntries(o.scopes.map((s) => [s.id, s.pausedDays]));
  assert.deepEqual(by['tx-1'], [today], 'a hand pause from today counts');
  assert.deepEqual(by.smart, [d(1)], 'an automatic pause counts');
  assert.deepEqual(by['no-1'], [d(13)], 'the window is 14 days: today and the 13 before it');
  assert.deepEqual(by['is-2'], []);
  const sm = o.scopes.find((s) => s.id === 'smart');
  assert.equal(sm.lastPaused, d(1));
  assert.equal(sm.tiers.length, 4);
  assert.deepEqual(sm.tiers.map((t) => t.pausedDays), [[d(1)], [d(1)], [d(1)], [d(1)]], 'every term of the Smart range was under its break-even');
});

test('the backtest replays the rule over the last 30 days with the typed settings and changes nothing', async () => {
  // Market left by the tests above: ASICs gross is high on d(3) and d(2) and far too low on d(1); the Smart ratio is 0.5 on all three.
  const stored = JSON.stringify([metaGet('guard'), metaGet('guarddays')]);
  const r = await guardBacktest({ asicsAuto: true, smartAuto: true, margin: 0, buffer: 2 });
  assert.equal(r.ok, true);
  assert.equal(r.days, 30);
  assert.equal(r.withData, 3);
  assert.equal(r.margin, 0);
  assert.equal(r.buffer, 2);
  const by = Object.fromEntries(r.scopes.map((s) => [s.id, s.days]));
  assert.deepEqual(by['tx-1'], [d(1)]);
  assert.deepEqual(by['is-2'], [d(1)]);
  assert.deepEqual(by['no-1'], [d(1)]);
  assert.deepEqual(by[FIRST], [d(3), d(2), d(1)], 'oldest first');
  assert.deepEqual(by[LAST], [d(3), d(2), d(1)]);
  assert.equal(by.smart, undefined, 'Smart is listed per plan, not as one scope');
  const off = await guardBacktest({ asicsAuto: false, smartAuto: true, margin: 0, buffer: 2 });
  assert.deepEqual(off.scopes.find((s) => s.id === 'tx-1').days, [], 'the typed switch counts, not the saved one');
  assert.equal((await guardBacktest({ margin: 80, buffer: 1 })).ok, false, 'limits apply');
  assert.equal(JSON.stringify([metaGet('guard'), metaGet('guarddays')]), stored, 'nothing is saved or decided');
});

test('a day when every Smart coin loses money is kept as ratio 0 and paused; a day with no coin data keeps nothing', async () => {
  assert.equal((await saveGuardSettings({ asicsAuto: true, smartAuto: true, mode: 'extend', margin: 0, buffer: 2, smartFloor: 0.5 })).ok, true);
  await metaSet('guarddays', { upto: d(6), paused: {}, smart: {} });
  // d(5) has no coin rows at all; on d(4) the only coin loses money (net per rig is negative, so it has no ratio of its own).
  await q("INSERT INTO coin_days (day, coin, price_usd, gross_per_unit, net_per_rig, at) VALUES ($1, 'BTC', 1, 0.1, -2, $2)", [d(4), d(4) + 1000]);
  assert.equal(await ensureGuardDays(Date.now()), 5);
  const g = metaGet('guarddays');
  assert.equal(g.smart[d(5)], undefined, 'no market data: nothing is kept, nothing is paused');
  assert.deepEqual(g.smart[d(4)], [0, 0.5, 0.02, 1], 'every coin lost money: ratio 0 under the floor');
  const s = await guardState();
  for (const scope of [FIRST, LAST]) {
    assert.equal(isPaused(s, scope, d(5)), false, `${scope} is not paused on a day with no data`);
    assert.equal(isPaused(s, scope, d(4)), true, `${scope} is paused when every coin loses money`);
  }
  await q('DELETE FROM coin_days WHERE day = $1', [d(4)]);
});
