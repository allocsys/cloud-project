// Profit guard: the days on which ASICs power and Smart Mining are switched off because they would not be profitable.
// Pure (no storage), so it runs on the server and in the browser.
//
// A scope is one thing that can be paused: an ASICs hall (its id), or one kind of Smart Mining contract. Smart contracts do not
// share a scope: each has its own break-even (it depends on its payout and its term), so its scope is derived from the contract
// itself, 'smart:<days>:<payout in units of 0.001% a day>' (scopeOf). Hand flips use the one scope 'smart' for all of them.
// A day (UTC midnight, in ms) is paused for a scope when
//   1. the admin flipped it by hand: manual[scope] is a list of { from, state } entries, state 'paused', 'active' or 'auto';
//      the last entry that starts on or before the day wins, 'auto' hands the day back to rule 2, or
//   2. the automatic rule paused it: guard.paused[day] lists the scopes. These are decided once per finished day from that
//      day's final market and then locked (lib/server/guard.js), so a paid day never changes.
// A paused day pays nothing and, for a miner whose rule is 'extend' (the default), does not use up its term: the term is
// extended by one day. A miner whose rule is 'zero' keeps its term and simply gets nothing that day.
export const DAY = 86400000;
// smartFloor is a ratio (1 = the anchor day), not a percent: Smart Mining pauses when the best coin's ratio is under it (0 = never).
export const GUARD_DEFAULT = { asicsAuto: true, smartAuto: true, mode: 'extend', margin: 0, buffer: 0.02, smartFloor: 0.5 };
export const GUARD_LIMITS = { margin: 0.5, buffer: 0.2, smartFloor: 2 }; // the most the admin can type (50%, 20%, ratio 2)
export const SMART_GUARD_DAYS = 90; // the term profitShareSmart measures on when it is not given one

// Smart Mining scopes. The automatic rule is not stored per scope: every finished day keeps the best coin's ratio and the rule in
// force that day, and the paused days of a scope are replayed from that (so a paid day never changes, whatever the settings are later).
// guard.smart[day] = [ratio, floor, buffer, 1] is the current rule: paused when the ratio is under the floor, resumes at floor plus
// buffer (the same for every Smart plan). A day stored as [ratio, margin, buffer] (three items) was decided under the old break-even
// rule, which depends on the plan's payout and term, and is still replayed that way.
const SMART_UNITS = 1e5;
const SMART_SCOPE = /^smart:(\d+):(\d+)$/;
export const smartScope = (days, payout) => `smart:${days}:${Math.round(payout * SMART_UNITS)}`;
export function parseSmartScope(scope) {
  const m = SMART_SCOPE.exec(String(scope ?? ''));
  return m ? { days: Number(m[1]), payout: Number(m[2]) / SMART_UNITS } : null;
}
// The net profit a day a Smart contract was bought with, from its base yield: baseYield = (1 + payout x days) / days.
export const contractPayout = (c) => (c.baseYield * c.days - 1) / c.days;
export function scopeOf(c) {
  if (!c?.smart) return c?.hall;
  const p = contractPayout(c);
  return p > 0 && c.days > 0 ? smartScope(c.days, p) : 'smart';
}

// The days a Smart scope is paused by the automatic rule, from the stored days { [day]: [ratio, margin, buffer] }: replayed oldest
// first from a clean start, resuming only above margin plus buffer. A day with no entry pauses nothing.
export function smartReplay(smartDays, days, payout) {
  const out = new Set();
  const keys = Object.keys(smartDays || {}).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!keys.length) return out;
  let was = false;
  for (let d = keys[0]; d <= keys[keys.length - 1]; d += DAY) {
    const e = smartDays[d];
    const on = Array.isArray(e) ? autoPaused(e.length > 3 ? e[0] : profitShareSmart(e[0], payout, days), was, e[1], e[2]) : false;
    if (on) out.add(d);
    was = on;
  }
  return out;
}

const smartCache = new WeakMap(); // guard.smart object -> { 'days:units' -> Set of paused days }
function smartPausedSet(guard, days, payout) {
  const sd = guard?.smart;
  if (!sd || typeof sd !== 'object') return null;
  let byKey = smartCache.get(sd);
  if (!byKey) smartCache.set(sd, (byKey = new Map()));
  const key = `${days}:${Math.round(payout * SMART_UNITS)}`;
  let set = byKey.get(key);
  if (!set) byKey.set(key, (set = smartReplay(sd, days, payout)));
  return set;
}

// The paused days (oldest first) the automatic rule gives a Smart scope; hand flips are not part of it.
export function smartPausedDays(guard, scope) {
  const p = parseSmartScope(scope);
  const set = p ? smartPausedSet(guard, p.days, p.payout) : null;
  return set ? [...set].sort((a, b) => a - b) : [];
}

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
    smartFloor: frac(r.smartFloor, GUARD_DEFAULT.smartFloor, GUARD_LIMITS.smartFloor),
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
  const smart = parseSmartScope(scope);
  const m = manualState(guard.manual, smart ? 'smart' : scope, day);
  if (m === 'paused') return true;
  if (m === 'active') return false;
  if (smart) return !!smartPausedSet(guard, smart.days, smart.payout)?.has(day);
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

// The same for Smart Mining under the OLD pay rule (days decided before the floor rule), from the best coin's ratio on the day: a Smart day paid budget x baseYield x ratio, of which
// budget / days is the principal coming back, so profit / payout = 1 - 1 / ((1 + payout x days) x ratio). Measured on the
// contract's own payout and term. Null when there is no ratio.
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

// The automatic rule for one finished day, for every ASICs hall at once: the halls that go off. `rates` is { [hallId]: { elec, maint } },
// `gross` the day's BTC gross per TH/s (null when there is none), `settings` the normalised guard settings and `before` the Set of
// scopes the rule had off the day before. Smart Mining is not decided here: it is replayed per contract (smartReplay). Used for the
// daily decision (lib/server/guard.js) and for the backtest, so both always follow the same rule.
export function decideDay({ gross, rates, settings, before }) {
  const off = [];
  if (settings.asicsAuto && gross > 0) {
    for (const [id, r] of Object.entries(rates || {})) {
      if (autoPaused(profitShareAsic(gross, r), before.has(id), settings.margin, settings.buffer)) off.push(id);
    }
  }
  return off;
}

// Runs the rule over finished days, oldest first, starting with nothing paused. `days` is [{ day, gross, best }] (see decideDay);
// a day without data pauses nothing. Returns { [scope]: [day, ...] } with the paused days oldest first, for the scopes that paused.
// Pure and read-only: it decides nothing for real.
export function replayGuard(days, { rates, settings }) {
  const out = {};
  let before = new Set();
  for (const d of days) {
    const off = decideDay({ gross: d.gross, rates, settings, before });
    for (const s of off) (out[s] ||= []).push(d.day);
    before = new Set(off);
  }
  return out;
}

// The same replay for one Smart scope: `days` is [{ day, best }], the paused days come back oldest first. Pure and read-only.
export function replaySmart(days, { settings, scope }) {
  const p = parseSmartScope(scope);
  if (!p || !settings.smartAuto) return [];
  const sd = {};
  const floor = Number.isFinite(settings.smartFloor) ? settings.smartFloor : GUARD_DEFAULT.smartFloor;
  for (const d of days) if (d.best > 0) sd[d.day] = [d.best, floor, settings.buffer, 1];
  return [...smartReplay(sd, p.days, p.payout)].sort((a, b) => a - b);
}
