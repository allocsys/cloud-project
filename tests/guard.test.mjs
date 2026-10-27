import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY, GUARD_DEFAULT, normalizeGuard, manualState, isPaused, termEnd, pausedDays, profitShareAsic, profitShareSmart, autoPaused, decideDay, replayGuard, replaySmart, smartReplay, smartPausedDays, parseSmartScope, contractPayout, scopeOf } from '../lib/guard.js';
import { usdPerDay } from '../lib/earnings.js';

const D0 = 20000 * DAY; // some UTC midnight
const asic = { hall: 'tx-1', th: 10, days: 5, dailyUsd: 2, startedAt: D0 };

test('decideDay: one rule for every scope, and a scope paused the day before needs margin plus buffer to resume', () => {
  const rates = { a: { elec: 0.01, maint: 0.002 }, b: { elec: 0.005, maint: 0.001 } };
  const settings = { asicsAuto: true, smartAuto: true, margin: 0, buffer: 0.02 };
  const base = { rates, payout: 0.003, settings };
  assert.deepEqual(decideDay({ ...base, gross: 0.011, best: 2, before: new Set() }), ['a'], 'only the hall that loses money');
  assert.deepEqual(decideDay({ ...base, gross: 0.0121, best: 2, before: new Set() }), [], 'just above break-even stays on');
  assert.deepEqual(decideDay({ ...base, gross: 0.0121, best: 2, before: new Set(['a']) }), ['a'], 'but stays off once paused');
  assert.deepEqual(decideDay({ ...base, gross: 0.02, best: 0.5, before: new Set() }), [], 'Smart is not decided here: it is replayed per contract');
  assert.deepEqual(decideDay({ ...base, gross: null, best: null, before: new Set() }), [], 'no data pauses nothing');
  assert.deepEqual(decideDay({ ...base, settings: { ...settings, asicsAuto: false, smartAuto: false }, gross: 0.011, best: 0.5, before: new Set() }), [], 'switched off');
});

test('replayGuard: oldest first from a clean start, resumes only above margin plus buffer, skips days with no data', () => {
  const rates = { a: { elec: 0.01, maint: 0.002 } };
  const settings = { asicsAuto: true, smartAuto: false, margin: 0, buffer: 0.02 };
  const days = [
    { day: 1 * DAY, gross: 0.02, best: null }, // good
    { day: 2 * DAY, gross: 0.011, best: null }, // loses: paused
    { day: 3 * DAY, gross: 0.0121, best: null }, // barely profitable, still paused (needs margin plus buffer)
    { day: 4 * DAY, gross: 0.02, best: null }, // good: resumes
    { day: 5 * DAY, gross: null, best: null }, // no data: nothing
    { day: 6 * DAY, gross: 0.0121, best: null }, // barely profitable and not paused the day before: stays on
  ];
  assert.deepEqual(replayGuard(days, { rates, payout: 0.003, settings }), { a: [2 * DAY, 3 * DAY] });
  assert.deepEqual(replayGuard([], { rates, payout: 0.003, settings }), {});
});

test('settings: defaults, limits and cleaning', () => {
  const d = normalizeGuard(undefined);
  assert.equal(d.asicsAuto, true);
  assert.equal(d.smartAuto, true);
  assert.equal(d.mode, GUARD_DEFAULT.mode);
  assert.equal(d.margin, 0);
  assert.deepEqual(d.manual, {});
  const s = normalizeGuard({ asicsAuto: false, mode: 'zero', margin: 0.05, buffer: 0.5, manual: { 'tx-1': [{ from: 3, state: 'paused' }, { from: 1, state: 'active' }, { from: 2, state: 'bogus' }], smart: 'x' } });
  assert.equal(s.asicsAuto, false);
  assert.equal(s.mode, 'zero');
  assert.equal(s.margin, 0.05);
  assert.equal(s.buffer, GUARD_DEFAULT.buffer, 'a buffer above the limit falls back to the default');
  assert.deepEqual(s.manual['tx-1'], [{ from: 1, state: 'active' }, { from: 3, state: 'paused' }]);
  assert.equal(s.manual.smart, undefined);
});

test('a hand flip beats the automatic rule, and auto hands the day back', () => {
  const manual = { 'tx-1': [{ from: D0 + DAY, state: 'paused' }, { from: D0 + 3 * DAY, state: 'active' }, { from: D0 + 5 * DAY, state: 'auto' }] };
  const guard = { paused: { [D0 + 4 * DAY]: ['tx-1'], [D0 + 6 * DAY]: ['tx-1'] }, manual };
  assert.equal(manualState(manual, 'tx-1', D0), 'auto');
  assert.equal(isPaused(guard, 'tx-1', D0), false, 'before the first flip: automatic says no');
  assert.equal(isPaused(guard, 'tx-1', D0 + DAY), true, 'paused by hand');
  assert.equal(isPaused(guard, 'tx-1', D0 + 4 * DAY), false, 'kept on by hand beats the automatic pause');
  assert.equal(isPaused(guard, 'tx-1', D0 + 6 * DAY), true, 'back to automatic: the automatic pause counts');
  assert.equal(isPaused(guard, 'is-2', D0 + DAY), false, 'other halls are not touched');
  assert.equal(isPaused(null, 'tx-1', D0), false);
});

test('the term of an extend miner moves back one day for each paused day', () => {
  const start = D0;
  const none = { paused: {}, manual: {} };
  assert.equal(termEnd(asic, start, none), start + 5 * DAY);
  const two = { paused: { [D0 + DAY]: ['tx-1'], [D0 + 3 * DAY]: ['tx-1'] }, manual: {} };
  assert.equal(termEnd(asic, start, two), start + 7 * DAY);
  assert.equal(pausedDays(asic, start, start + 30 * DAY, two), 2);
  assert.equal(termEnd({ ...asic, pauseRule: 'zero' }, start, two), start + 5 * DAY, 'a zero miner keeps its term');
  assert.equal(termEnd(asic, start, null), start + 5 * DAY);
});

test('a day paused on another hall does not extend this miner', () => {
  const g = { paused: { [D0 + DAY]: ['is-2'] }, manual: {} };
  assert.equal(termEnd(asic, D0, g), D0 + 5 * DAY);
  assert.equal(scopeOf({ smart: true }), 'smart');
  assert.equal(scopeOf(asic), 'tx-1');
});

test('profit share: ASICs hall and Smart Mining', () => {
  assert.ok(Math.abs(profitShareAsic(0.05, { elec: 0.03, maint: 0.01 }) - 0.2) < 1e-9);
  assert.ok(profitShareAsic(0.03, { elec: 0.03, maint: 0.01 }) < 0, 'a losing day is negative');
  assert.equal(profitShareAsic(0, { elec: 0.03, maint: 0.01 }), null);
  assert.equal(profitShareAsic(0.05, null), null);
  const breakEven = 1 / (1 + 0.003 * 90);
  assert.ok(Math.abs(profitShareSmart(breakEven, 0.003)) < 1e-9, 'at the break-even ratio the share is zero');
  assert.ok(profitShareSmart(1, 0.003) > 0);
  assert.ok(profitShareSmart(0.5, 0.003) < 0);
  assert.equal(profitShareSmart(0, 0.003), null);
});

test('automatic rule: margin, hysteresis and no data', () => {
  assert.equal(autoPaused(0.01, false, 0.05, 0.02), true, 'below the margin pauses');
  assert.equal(autoPaused(0.06, false, 0.05, 0.02), false);
  assert.equal(autoPaused(0.06, true, 0.05, 0.02), true, 'once paused it needs margin plus buffer to resume');
  assert.equal(autoPaused(0.08, true, 0.05, 0.02), false);
  assert.equal(autoPaused(null, true, 0.05, 0.02), false, 'no data never pauses');
  assert.equal(autoPaused(NaN, false, 0, 0), false);
  assert.equal(autoPaused(-0.01, false, 0, 0), true, 'a losing day pauses at break even');
});

test('a paused day pays nothing', () => {
  const day = D0 + 2 * DAY;
  const now = D0 + 10 * DAY;
  const market = { guard: { paused: { [day]: ['tx-1'] }, manual: {} } };
  assert.equal(usdPerDay(asic, day, market, now), 0);
  assert.equal(usdPerDay(asic, day + DAY, market, now), 2);
  assert.equal(usdPerDay(asic, day, null, now), 2, 'no guard, no pause');
});

// Smart Mining: a $100 plan on 90 days at 0.21% a day breaks even at ratio 1 / 1.189 = 0.841; a $10,000 plan on 150 days at 0.42%
// breaks even at 1 / 1.63 = 0.614. The same market day can pause the first and not the second.
const smallSmart = { smart: true, budget: 100, days: 90, baseYield: (1 + 0.0021 * 90) / 90, th: 0, hall: 'smart', dailyUsd: 1 };
const bigSmart = { smart: true, budget: 10000, days: 150, baseYield: (1 + 0.0042 * 150) / 150, th: 0, hall: 'smart', dailyUsd: 1 };
const N = (n) => D0 + n * DAY;
const smartDays = { [N(1)]: [0.9, 0, 0.02], [N(2)]: [0.7, 0, 0.02], [N(3)]: [0.85, 0, 0.02], [N(4)]: [1.2, 0, 0.02] };

test('a Smart contract has its own scope, worked out from its payout and term', () => {
  assert.equal(scopeOf(smallSmart), 'smart:90:210');
  assert.equal(scopeOf(bigSmart), 'smart:150:420');
  assert.ok(Math.abs(contractPayout(smallSmart) - 0.0021) < 1e-12);
  assert.deepEqual(parseSmartScope('smart:90:210'), { days: 90, payout: 0.0021 });
  assert.equal(parseSmartScope('smart'), null);
  assert.equal(parseSmartScope('tx-1'), null);
  assert.equal(scopeOf({ smart: true }), 'smart', 'a Smart contract with no yield falls back to the plain scope');
});

test('the same day pauses a small Smart plan and not a big one, and resumes only above margin plus buffer', () => {
  const guard = { smart: smartDays, manual: {} };
  const small = [1, 2, 3, 4, 5].map((n) => isPaused(guard, scopeOf(smallSmart), N(n)));
  assert.deepEqual(small, [false, true, true, false, false], 'ratio 0.7 pauses; 0.85 is profitable but not yet above the buffer; a day with no entry pauses nothing');
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => isPaused(guard, scopeOf(bigSmart), N(n))), [false, false, false, false, false]);
  assert.equal(isPaused(guard, scopeOf(smallSmart), D0), false, 'before the first stored day');
  assert.deepEqual(smartPausedDays(guard, scopeOf(smallSmart)), [N(2), N(3)]);
  assert.deepEqual(smartPausedDays(guard, scopeOf(bigSmart)), []);
  assert.deepEqual(smartPausedDays({ manual: {} }, scopeOf(smallSmart)), [], 'no stored days');
});

test('the margin and buffer stored with a day are the ones that day was decided with', () => {
  const strict = { [N(1)]: [0.9, 0.1, 0.02] }; // a 6.5% profit share is under a 10% margin
  assert.equal(isPaused({ smart: strict, manual: {} }, scopeOf(smallSmart), N(1)), true);
  assert.equal(isPaused({ smart: smartDays, manual: {} }, scopeOf(smallSmart), N(1)), false);
  assert.equal(smartReplay({ [N(1)]: [0.9, 0, 0] }, 90, 0.0021).size, 0);
});

test('a hand flip on smart covers every Smart plan and beats the automatic rule', () => {
  const manual = { smart: [{ from: N(1), state: 'paused' }, { from: N(2), state: 'active' }] };
  const guard = { smart: smartDays, manual };
  assert.equal(isPaused(guard, scopeOf(smallSmart), N(1)), true);
  assert.equal(isPaused(guard, scopeOf(bigSmart), N(1)), true);
  assert.equal(isPaused(guard, scopeOf(smallSmart), N(2)), false, 'kept on by hand although the rule would pause it');
  assert.equal(isPaused(guard, 'tx-1', N(1)), false, 'a hall is not touched');
});

test('a Smart plan paused by the rule has its term pushed back and earns nothing that day', () => {
  const guard = { smart: smartDays, manual: {} };
  assert.equal(termEnd(smallSmart, D0, guard), D0 + 92 * DAY);
  assert.equal(termEnd(bigSmart, D0, guard), D0 + 150 * DAY);
  assert.equal(termEnd({ ...smallSmart, pauseRule: 'zero' }, D0, guard), D0 + 90 * DAY);
  assert.equal(pausedDays(smallSmart, D0, D0 + 30 * DAY, guard), 2);
  const now = D0 + 10 * DAY;
  assert.equal(usdPerDay(smallSmart, N(2), { guard }, now), 0);
  assert.ok(usdPerDay(smallSmart, N(4), { guard }, now) > 0);
  assert.ok(usdPerDay(bigSmart, N(2), { guard }, now) > 0);
});

test('replaySmart: the backtest follows the same rule, and a day with no data resets it', () => {
  const days = [{ day: N(1), best: 0.9 }, { day: N(2), best: 0.7 }, { day: N(3), best: null }, { day: N(4), best: 1.2 }];
  const settings = { smartAuto: true, margin: 0, buffer: 0.02, smartFloor: 0.8 };
  assert.deepEqual(replaySmart(days, { settings, scope: scopeOf(smallSmart) }), [N(2)]);
  assert.deepEqual(replaySmart(days, { settings, scope: scopeOf(bigSmart) }), [N(2)], 'the floor is the same for every plan');
  assert.deepEqual(replaySmart(days, { settings: { ...settings, smartFloor: 0.5 }, scope: scopeOf(smallSmart) }), [], 'under the default floor 0.5 none of these pause');
  assert.deepEqual(replaySmart(days, { settings: { ...settings, smartFloor: 0 }, scope: scopeOf(smallSmart) }), [], 'floor 0 never pauses');
  assert.deepEqual(replaySmart(days, { settings: { ...settings, smartAuto: false }, scope: scopeOf(smallSmart) }), []);
  assert.deepEqual(replaySmart(days, { settings, scope: 'tx-1' }), []);
});
