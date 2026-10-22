// Profit guard, server side. Rules and maths are in lib/guard.js; this file stores them.
//
//   meta "guard"      the admin's settings and hand flips: { asicsAuto, smartAuto, mode, margin, buffer, manual }
//   meta "guarddays"  { upto, paused: { [utcMidnightMs]: [scope] } }: the automatic decisions, one per finished UTC day,
//                     written once from that day's final market and then locked (a paid day never changes). `upto` is the
//                     last day decided. The first run starts at yesterday, so nothing is decided backwards in time.
// A change reaches every server within a few seconds (the meta cache). Settings only ever apply to days not yet decided.
import { q, warm, metaGet, metaUpdate, catalog, allUserIds, withUsers, notify } from '@/lib/server/db';
import { DAY, GUARD_LIMITS, normalizeGuard, manualState, isPaused, decideDay, replayGuard, scopeOf } from '@/lib/guard';
import { hallRates } from '@/lib/fees';
import { ratioOf } from '@/lib/smart';
import { smartSettings } from '@/lib/server/smart-admin';

const MAX_CATCH_UP = 400;
const KEEP_DAYS = 800;
const RECHECK = 60_000;
const HISTORY_DAYS = 14; // how many days back the admin card lists paused days
const BACKTEST_DAYS = 30; // how many finished days the backtest replays
const utcDay = (t) => Math.floor(t / DAY) * DAY;
const fail = (status, error) => ({ ok: false, status, error });
const done = { ok: true, status: 200 };
const st = (globalThis.__opusGuard ||= { at: 0, inflight: null });

// The settings with defaults and limits applied.
export async function guardSettings() {
  await warm();
  return normalizeGuard(metaGet('guard'));
}

// Tells the owners of miners in a scope that the automatic rule paused it on `day`, or that it resumed. Once per decided day.
// A paused day pays nothing; what it does to the term depends on each miner's own rule (pauseRule).
async function notifyChanges(changes, day) {
  if (!changes.paused.length && !changes.resumed.length) return;
  const halls = catalog().halls || {};
  const label = (s) => (s === 'smart' ? 'Smart Mining' : halls[s]?.name || s);
  const dayText = new Date(day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const ids = await allUserIds();
  for (let i = 0; i < ids.length; i += 100) {
    await withUsers(ids.slice(i, i + 100), (map) => {
      for (const u of map.values()) {
        const live = (s) => u.contracts.filter((c) => scopeOf(c) === s && c.online !== false);
        for (const s of changes.paused) {
          const mine = live(s);
          if (!mine.length) continue;
          const zero = mine.some((c) => c.pauseRule === 'zero');
          const extend = mine.some((c) => c.pauseRule !== 'zero');
          const tail = zero && extend ? 'It paid nothing; the day is added to the end of the terms that extend.' : zero ? 'It paid nothing and counts toward your term.' : 'It paid nothing and your term is extended by a day.';
          notify(u, { kind: 'news', title: 'Mining paused for a day', body: `${label(s)} was switched off on ${dayText} because that day would not have been profitable. ${tail}` });
        }
        for (const s of changes.resumed) {
          if (live(s).length) notify(u, { kind: 'news', title: 'Mining resumed', body: `${label(s)} is mining again: it is profitable.` });
        }
      }
    });
  }
}

// Writes what the automatic rule changed into the admin audit log ('guard-auto'), one entry per decided day on which a scope was
// paused or resumed, newest first. events is oldest first.
async function logAuto(events) {
  if (!events.length) return;
  const halls = catalog().halls || {};
  const names = (list) => list.map((s) => (s === 'smart' ? 'Smart Mining' : halls[s]?.name || s)).join(', ');
  const at = Date.now();
  const entries = events
    .map((e) => {
      const day = new Date(e.day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
      const parts = [e.added.length ? `paused ${names(e.added)}` : '', e.gone.length ? `resumed ${names(e.gone)}` : ''].filter(Boolean);
      return { at, action: 'guard-auto', detail: `${day} · ${parts.join(' · ')}`.slice(0, 120) };
    })
    .reverse();
  await metaUpdate('adminlog', (cur) => ({ value: [...entries, ...(cur || [])].slice(0, 100) }));
}

// Writes the automatic decision of every finished day that has none yet, oldest first. Returns how many days it decided.
export async function ensureGuardDays(now = Date.now()) {
  await warm();
  const today = utcDay(now);
  const cur0 = metaGet('guarddays');
  if (cur0 && Number.isFinite(cur0.upto) && cur0.upto >= today - DAY) return 0;
  const settings = normalizeGuard(metaGet('guard'));
  const payout = (await smartSettings()).payout;
  const halls = catalog().halls || {};
  const rates = Object.fromEntries(Object.entries(halls).map(([id, h]) => [id, hallRates(h)]));
  const refs = {};
  for (const r of (await q('SELECT symbol, ref_gross FROM smart_coins')).rows) if (r.ref_gross !== null) refs[r.symbol] = Number(r.ref_gross);

  const out = await metaUpdate('guarddays', async (cur) => {
    if (!cur || !Number.isFinite(cur.upto)) return { value: { upto: today - DAY, paused: {} }, result: { n: 0 } };
    if (cur.upto >= today - DAY) return { result: { n: 0 } };
    const paused = { ...(cur.paused || {}) };
    let upto = cur.upto;
    let n = 0;
    const events = [];
    for (let day = upto + DAY; day <= today - DAY && n < MAX_CATCH_UP; day += DAY, n += 1) {
      const before = new Set(paused[day - DAY] || []);
      const [mk, cd] = await Promise.all([
        q('SELECT gross_per_th FROM market_days WHERE day = $1', [day]),
        q('SELECT coin, gross_per_unit FROM coin_days WHERE day = $1', [day]),
      ]);
      const gross = mk.rows[0] ? Number(mk.rows[0].gross_per_th) : null;
      const ratios = cd.rows.map((r) => ratioOf(Number(r.gross_per_unit), refs[r.coin])).filter((x) => Number.isFinite(x) && x > 0);
      const best = ratios.length ? Math.max(...ratios) : null;
      const off = decideDay({ gross, best, rates, payout, settings, before });
      const added = off.filter((s) => !before.has(s));
      const gone = [...before].filter((s) => !off.includes(s));
      if (added.length || gone.length) events.push({ day, added, gone });
      if (off.length) paused[day] = off;
      upto = day;
    }
    for (const d of Object.keys(paused)) if (Number(d) < today - KEEP_DAYS * DAY) delete paused[d];
    // What changed on the newest decided day, for the notifications (older days of a long catch-up are not announced).
    const was = new Set(paused[upto - DAY] || []);
    const is = new Set(paused[upto] || []);
    const changes = { paused: [...is].filter((s) => !was.has(s)), resumed: [...was].filter((s) => !is.has(s)) };
    return { value: { upto, paused }, result: { n, last: upto, changes, events: events.slice(-20) } };
  });
  if (out?.events) await logAuto(out.events).catch((e) => console.error('[guard] could not write the audit log:', e.message));
  if (out?.changes) await notifyChanges(out.changes, out.last).catch((e) => console.error('[guard] could not notify:', e.message));
  return out?.n ?? 0;
}

// What lib/earnings.js and lib/guard.js read as market.guard: { paused, manual }. Decides any finished days first (and waits for
// that, so a day never shows as paid and then flips), at most once a minute when there is nothing due. Never throws.
export async function guardState() {
  try {
    await warm();
    const cur = metaGet('guarddays');
    const due = !cur || !Number.isFinite(cur.upto) || cur.upto < utcDay(Date.now()) - DAY;
    if (due && !st.inflight && Date.now() - st.at >= RECHECK) {
      st.at = Date.now();
      st.inflight = ensureGuardDays()
        .catch((e) => console.error('[guard] could not decide the finished days:', e.message))
        .finally(() => {
          st.inflight = null;
        });
    }
    if (due && st.inflight) await st.inflight;
  } catch (e) {
    console.error('[guard] state unavailable:', e.message);
  }
  return { paused: metaGet('guarddays')?.paused || {}, manual: normalizeGuard(metaGet('guard')).manual };
}

// ---- Admin ----

const pct = (v, max) => {
  const n = Number(String(v ?? '').trim().replace(',', '.'));
  return Number.isFinite(n) && n >= 0 && n <= max * 100 ? Math.round(n * 100) / 10000 : null;
};
const flag = (v) => v !== false && v !== 'false';

// Saves the automatic rules. margin and buffer arrive as percent (2 means 2%). The hand flips are kept as they are.
export async function saveGuardSettings(input) {
  const margin = pct(input?.margin, GUARD_LIMITS.margin);
  const buffer = pct(input?.buffer, GUARD_LIMITS.buffer);
  if (margin === null) return fail(422, `Profit margin must be between 0% and ${GUARD_LIMITS.margin * 100}%.`);
  if (buffer === null) return fail(422, `Buffer must be between 0% and ${GUARD_LIMITS.buffer * 100}%.`);
  const value = { asicsAuto: flag(input?.asicsAuto), smartAuto: flag(input?.smartAuto), mode: input?.mode === 'zero' ? 'zero' : 'extend', margin, buffer };
  await metaUpdate('guard', (cur) => ({ value: { ...(cur || {}), ...value } }));
  return { ...done, ...value };
}

// What the automatic rule would have done over the last BACKTEST_DAYS finished UTC days, with the margin and buffer typed in the
// admin card (percent) and its switches as they stand there; whatever is left out comes from the saved settings. Read-only:
// nothing is saved and no decided day changes. Hand flips are not part of it, only the rule. A day with no market data pauses
// nothing, and `withData` says how many of the days had any.
export async function guardBacktest(input) {
  await warm();
  const saved = normalizeGuard(metaGet('guard'));
  const margin = input?.margin === undefined || input.margin === '' ? saved.margin : pct(input.margin, GUARD_LIMITS.margin);
  const buffer = input?.buffer === undefined || input.buffer === '' ? saved.buffer : pct(input.buffer, GUARD_LIMITS.buffer);
  if (margin === null) return fail(422, `Profit margin must be between 0% and ${GUARD_LIMITS.margin * 100}%.`);
  if (buffer === null) return fail(422, `Buffer must be between 0% and ${GUARD_LIMITS.buffer * 100}%.`);
  const settings = {
    ...saved,
    asicsAuto: input?.asicsAuto === undefined ? saved.asicsAuto : flag(input.asicsAuto),
    smartAuto: input?.smartAuto === undefined ? saved.smartAuto : flag(input.smartAuto),
    margin,
    buffer,
  };
  const today = utcDay(Date.now());
  const from = today - BACKTEST_DAYS * DAY;
  const halls = catalog().halls || {};
  const rates = Object.fromEntries(Object.entries(halls).map(([id, h]) => [id, hallRates(h)]));
  const payout = (await smartSettings()).payout;
  const [mk, cd, rf] = await Promise.all([
    q('SELECT day, gross_per_th FROM market_days WHERE day >= $1 AND day < $2', [from, today]),
    q('SELECT day, coin, gross_per_unit FROM coin_days WHERE day >= $1 AND day < $2', [from, today]),
    q('SELECT symbol, ref_gross FROM smart_coins'),
  ]);
  const refs = {};
  for (const r of rf.rows) if (r.ref_gross !== null) refs[r.symbol] = Number(r.ref_gross);
  const gross = new Map(mk.rows.map((r) => [Number(r.day), Number(r.gross_per_th)]));
  const best = new Map();
  for (const r of cd.rows) {
    const x = ratioOf(Number(r.gross_per_unit), refs[r.coin]);
    if (Number.isFinite(x) && x > 0) best.set(Number(r.day), Math.max(best.get(Number(r.day)) ?? 0, x));
  }
  const days = [];
  for (let day = from; day < today; day += DAY) days.push({ day, gross: gross.get(day) ?? null, best: best.get(day) ?? null });
  const paused = replayGuard(days, { rates, payout, settings });
  const scope = (id, name) => ({ id, name, count: (paused[id] || []).length, days: paused[id] || [] });
  return {
    ...done,
    from,
    days: days.length,
    withData: days.filter((x) => x.gross !== null || x.best !== null).length,
    margin: Math.round(margin * 10000) / 100,
    buffer: Math.round(buffer * 10000) / 100,
    scopes: [...Object.entries(halls).map(([id, h]) => scope(id, h.name || id)), scope('smart', 'Smart Mining')],
  };
}

// Pauses or resumes one scope by hand (a hall id or 'smart'), or hands it back to the automatic rule ('auto').
// when: 'now' counts from today (UTC), anything else from tomorrow. Days already decided never change.
export async function setGuardManual(input) {
  const scope = String(input?.scope ?? '');
  if (scope !== 'smart' && !Object.hasOwn(catalog().halls || {}, scope)) return fail(404, 'Hall not found.');
  const state = String(input?.state ?? '');
  if (!['paused', 'active', 'auto'].includes(state)) return fail(422, 'Choose pause, resume or automatic.');
  const from = utcDay(Date.now()) + (input?.when === 'now' ? 0 : DAY);
  await metaUpdate('guard', (cur) => {
    const old = cur || {};
    const list = (old.manual?.[scope] || []).filter((e) => e.from < from);
    list.push({ from, state });
    return { value: { ...old, manual: { ...(old.manual || {}), [scope]: list.slice(-50) } } };
  });
  return { ...done, scope, state, from };
}

// For the admin card: the settings (margin and buffer in percent) and, for each scope, its hand setting, whether it is
// paused today and tomorrow, and the UTC days of the last HISTORY_DAYS (today included, newest first) on which it was switched
// off, by the rule or by hand.
export async function guardOverview() {
  const s = await guardSettings();
  const g = await guardState();
  const today = utcDay(Date.now());
  const halls = catalog().halls || {};
  const scope = (id, name) => ({
    id,
    name,
    manual: manualState(s.manual, id, today),
    manualNext: manualState(s.manual, id, today + DAY),
    pausedToday: isPaused(g, id, today),
    pausedDays: Array.from({ length: HISTORY_DAYS }, (_, i) => today - i * DAY).filter((day) => isPaused(g, id, day)),
    lastPaused: Object.keys(g.paused || {}).map(Number).filter((d) => g.paused[d].includes(id)).sort((a, b) => b - a)[0] ?? null,
  });
  return {
    settings: { asicsAuto: s.asicsAuto, smartAuto: s.smartAuto, mode: s.mode, margin: Math.round(s.margin * 10000) / 100, buffer: Math.round(s.buffer * 10000) / 100 },
    scopes: [...Object.entries(halls).map(([id, h]) => scope(id, h.name || id)), scope('smart', 'Smart Mining')],
  };
}
