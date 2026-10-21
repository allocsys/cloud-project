// Profit guard: the days on which ASICs power and Smart Mining are switched off because they would not be profitable.
// Pure (no storage), so it runs on the server and in the browser.
//
// A scope is one thing that can be paused: an ASICs hall (its id) or Smart Mining ('smart').
// A day (UTC midnight, in ms) is paused for a scope when
//   1. the admin flipped it by hand: manual[scope] is a list of { from, state } entries, state 'paused', 'active' or 'auto';
//      the last entry that starts on or before the day wins, 'auto' hands the day back to rule 2, or
//   2. the automatic rule paused it: guard.paused[day] lists the scopes. These are decided once per finished day from that
//      day's final market and then locked (lib/server/guard.js), so a paid day never changes.
// A paused day pays nothing and, for a miner whose rule is 'extend' (the default), does not use up its term: the term is
// extended by one day. A miner whose rule is 'zero' keeps its term and simply gets nothing that day.
export const DAY = 86400000;
export const GUARD_DEFAULT = { asicsAuto: true, smartAuto: true, mode: 'extend', margin: 0, buffer: 0.02 };
export const GUARD_LIMITS = { margin: 0.5, buffer: 0.2 }; // fractions: the most the admin can type (50% and 20%)
export const SMART_GUARD_DAYS = 90; // Smart break-even is measured on the shortest term, the most careful one

export const scopeOf = (c) => (c?.smart ? 'smart' : c?.hall);

// Settings with defaults and limits applied. `raw` is the saved meta entry (or nothing).
export function normalizeGuard(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const frac = (v, def, max) => (Number.isFinite(Number(v)) && v !== null && v !== '' && Number(v) >= 0 && Number(v) <= max ? Number(v) : def);
  const manual = {};
  for (const [scope, list] of Object.entries(r.manual && typeof r.manual === 'object' ? r.manual : {})) {
    if (!Array.isArray(list)) continue;
    const clean = list
      .filter((e) => e && Number.isFinite(e.from) && ['paused', 'active', 'auto'].includes(e.state))
      .map((e) => ({ from: e.from, state: e.state }))
      .sort((a, b) => a.from - b.from);
    if (clean.length) manual[scope] = clean;
  }
  return {
    asicsAuto: r.asicsAuto !== false,
    smartAuto: r.smartAuto !== false,
    mode: r.mode === 'zero' ? 'zero' : 'extend',
    margin: frac(r.margin, GUARD_DEFAULT.margin, GUARD_LIMITS.margin),
    buffer: frac(r.buffer, GUARD_DEFAULT.buffer, GUARD_LIMITS.buffer),
    manual,
  };
}

// The hand-set state of a scope on a day: 'paused', 'active' or 'auto' (no flip applies).
export function manualState(manual, scope, day) {
  const list = manual?.[scope];
  if (!list) return 'auto';
  let state = 'auto';
  for (const e of list) {
    if (e.from <= day) state = e.state;
    else break;
  }
  return state;
}

// Whether `scope` is switched off on `day`. `guard` is { paused: { [day]: [scope] }, manual } (market.guard), or nothing.
export function isPaused(guard, scope, day) {
  if (!guard || !scope) return false;
  const m = manualState(guard.manual, scope, day);
  if (m === 'paused') return true;
  if (m === 'active') return false;
  return !!guard.paused?.[day]?.includes(scope);
}

// When a miner's term ends, counting paused days. An 'extend' miner (the default) does not use up its term on a paused day, so
// each one pushes the end back by a day; a 'zero' miner, or no guard at all, ends at start + days. Capped, so a pause with no
// end cannot loop for ever.
export function termEnd(c, start, guard) {
  const plain = start + c.days * DAY;
  if (!guard || c.pauseRule === 'zero') return plain;
  const scope = scopeOf(c);
  let remaining = c.days * DAY;
  let cursor = start;
  let day = Math.floor(start / DAY) * DAY;
  for (let i = 0; i < c.days + 400; i += 1, day += DAY) {
    const next = day + DAY;
    if (isPaused(guard, scope, day)) {
      cursor = next;
      continue;
    }
    const slice = next - cursor;
    if (slice >= remaining) return cursor + remaining;
    remaining -= slice;
    cursor = next;
  }
  return cursor + remaining;
}

// How many whole paused days a miner has had inside its term up to `now` (what the term has been extended by so far).
export function pausedDays(c, start, now, guard) {
  if (!guard) return 0;
  const scope = scopeOf(c);
  const end = termEnd(c, start, guard);
  let n = 0;
  for (let day = Math.floor(start / DAY) * DAY; day < Math.min(end, now); day += DAY) if (isPaused(guard, scope, day)) n += 1;
  return n;
}

// Profit as a share of a day's revenue for one ASICs hall: (gross - electricity - maintenance) / gross, which is negative when
// the day loses money. `rates` is { elec, maint } from lib/fees.js hallRates. Null when it cannot be worked out.
export function profitShareAsic(gross, rates) {
  if (!rates || !(gross > 0)) return null;
  return (gross - rates.elec - rates.maint) / gross;
}

// The same for Smart Mining, from the best coin's ratio on the day: a Smart day pays budget x baseYield x ratio, of which
// budget / days is the principal coming back, so profit / payout = 1 - 1 / ((1 + payout x days) x ratio). Measured on the
// 90 day term. Null when there is no ratio.
export function profitShareSmart(ratio, payout, days = SMART_GUARD_DAYS) {
  if (!(ratio > 0) || !(payout > 0)) return null;
  return 1 - 1 / ((1 + payout * days) * ratio);
}

// The automatic rule for one scope on one finished day: paused when the profit share is below the margin, and once paused
// it only resumes when the share is back above margin + buffer, so it does not flip on and off around the line.
// A share of null (no data) never pauses.
export function autoPaused(share, wasPaused, margin, buffer) {
  if (share === null || !Number.isFinite(share)) return false;
  return share < (wasPaused ? margin + buffer : margin);
}
