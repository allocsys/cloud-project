import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY, GUARD_DEFAULT, normalizeGuard, manualState, isPaused, termEnd, pausedDays, profitShareAsic, profitShareSmart, autoPaused, scopeOf } from '../lib/guard.js';
import { usdPerDay } from '../lib/earnings.js';

const D0 = 20000 * DAY; // some UTC midnight
const asic = { hall: 'tx-1', th: 10, days: 5, dailyUsd: 2, startedAt: D0 };

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
