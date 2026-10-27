// Profit guard, server side. Rules and maths are in lib/guard.js; this file stores them.
//
//   meta "guard"      the admin's settings and hand flips: { asicsAuto, smartAuto, mode, margin, buffer, smartFloor, manual }
//   meta "guarddays"  { upto, paused: { [utcMidnightMs]: [scope] }, smart: { [utcMidnightMs]: [ratio, margin, buffer] } }: the automatic
//                     decisions, one per finished UTC day, written once from that day's final market and then locked (a paid day
//                     never changes). `paused` lists the ASICs halls that were off. Smart Mining is paused per contract, so it has no
//                     list: `smart` keeps the day's best coin ratio with the floor and buffer in force ([ratio, floor, buffer, 1]; older days
//                     hold [ratio, margin, buffer] from the break-even rule), and each contract's paused days are replayed from it
//                     (lib/guard.js smartReplay). `upto` is the last day decided. The first run starts at
//                     yesterday, so nothing is decided backwards in time.
// A change reaches every server within a few seconds (the meta cache). Settings only ever apply to days not yet decided.
import { q, warm, metaGet, metaUpdate, catalog, withUsers, notify } from '@/lib/server/db';
import { DAY, GUARD_LIMITS, normalizeGuard, manualState, isPaused, decideDay, replayGuard, replaySmart, smartReplay, smartScope, smartPausedDays, parseSmartScope, scopeOf } from '@/lib/guard';
import { hallRates } from '@/lib/fees';
import { ratioOf, SMART } from '@/lib/smart';
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

const r5 = (v) => Math.round(v * 1e5) / 1e5;
// How a Smart scope reads in messages and the admin log.
const smartLabel = (scope) => {
  const p = parseSmartScope(scope);
  return p ? `Smart Mining (${p.days} days, ${r5(p.payout * 100)}% a day)` : 'Smart Mining';
};
// The Smart scopes the admin card and the backtest show, one per term, each a typical plan: the middle of the pay table (halfway
// between its lowest and highest rate) plus the term's own bonus. A plan at the lowest rate pauses earlier and one at the highest later.
async function smartEnds() {
  const { table } = await smartSettings();
  const mid = (Math.min(...table.rates) + Math.max(...table.rates)) / 2;
  return SMART.terms.map((days) => {
    const payout = r5(Math.min(SMART.payoutMax, mid + (table.bonus[days] ?? 0)));
    return { scope: smartScope(days, payout), days, payout };
  });
}

// The settings with defaults and limits applied.
export async function guardSettings() {
  await warm();
  return normalizeGuard(metaGet('guard'));
}

// Tells the owners of miners in a scope that the automatic rule paused it on `day`, or that it resumed. Once per decided day.
// A paused day pays nothing; what it does to the term depends on each miner's own rule (pauseRule).
async function notifyChanges(changes, day, smart) {
  const smartCheck = !!smart && (day in smart || day - DAY in smart);
  if (!changes.paused.length && !changes.resumed.length && !smartCheck) return;
  const g = { smart, manual: {}, paused: {} }; // the automatic rule only: hand flips are not announced
  const halls = catalog().halls || {};
  const label = (s) => (s === 'smart' ? 'Smart Mining' : halls[s]?.name || s);
  const dayText = new Date(day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  // Only accounts with a miner in a changed hall, or a Smart Mining miner when a Smart scope may have changed, can get a notice.
  const scopes = [...changes.paused, ...changes.resumed];
  const wantSmart = smartCheck || scopes.some((s) => s === 'smart' || !!parseSmartScope(s));
  const ids = (
    await q(
      `SELECT id FROM users
        WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(data->'contracts') = 'array' THEN data->'contracts' ELSE '[]'::jsonb END) k
                       WHERE k->>'hall' = ANY($1::text[]) OR ($2::boolean AND k->>'smart' = 'true'))
        ORDER BY created_at, id`,
      [scopes, wantSmart],
    )
  ).rows.map((r) => r.id);
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
          notify(u, { kind: 'news', title: 'Mining paused for a day', body: `${label(s)} was switched off on ${dayText} because that day would not have been profitable. ${tail}`, code: 'paused', vars: { who: s === 'smart' ? 'smart' : 'hall', name: label(s), day, tail: zero && extend ? 'both' : zero ? 'zero' : 'extend' } });
        }
        for (const s of changes.resumed) {
          if (live(s).length) notify(u, { kind: 'news', title: 'Mining resumed', body: `${label(s)} is mining again: it is profitable.`, code: 'resumed', vars: { who: s === 'smart' ? 'smart' : 'hall', name: label(s) } });
        }
        if (smartCheck) {
          // Each Smart Mining plan has its own break-even, so one account can have some plans paused and others running.
          const mine = u.contracts.filter((c) => c.smart && c.online !== false && (!Number.isFinite(c.startedAt) || c.startedAt < day + DAY));
          const was = (c) => isPaused(g, scopeOf(c), day - DAY);
          const is = (c) => isPaused(g, scopeOf(c), day);
          const newly = mine.filter((c) => !was(c) && is(c));
          const back = mine.filter((c) => was(c) && !is(c));
          const floorRule = Array.isArray(smart?.[day]) && smart[day].length > 3; // decided under the floor rule, not break-even
          if (newly.length) {
            const zero = newly.some((c) => c.pauseRule === 'zero');
            const extend = newly.some((c) => c.pauseRule !== 'zero');
            const tail = zero && extend ? 'It paid nothing; the day is added to the end of the terms that extend.' : zero ? 'It paid nothing and counts toward your term.' : 'It paid nothing and your term is extended by a day.';
            const who = newly.length === mine.length ? 'Smart Mining was' : newly.length === 1 ? 'One of your Smart Mining plans was' : `${newly.length} of your Smart Mining plans were`;
            notify(u, { kind: 'news', title: 'Mining paused for a day', body: `${who} switched off on ${dayText} because ${floorRule ? 'market returns were too low' : 'that day would not have been profitable'}. ${tail}`, code: 'paused', vars: { floor: floorRule, who: newly.length === mine.length ? 'smart' : newly.length === 1 ? 'one' : 'many', n: newly.length, day, tail: zero && extend ? 'both' : zero ? 'zero' : 'extend' } });
          }
          if (back.length) {
            const who = back.length === mine.length ? 'Smart Mining is' : back.length === 1 ? 'One of your Smart Mining plans is' : `${back.length} of your Smart Mining plans are`;
            notify(u, { kind: 'news', title: 'Mining resumed', body: `${who} mining again: ${floorRule ? 'market returns have recovered' : 'it is profitable'}.`, code: 'resumed', vars: { floor: floorRule, who: back.length === mine.length ? 'smart' : back.length === 1 ? 'one' : 'many', n: back.length } });
          }
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
  const names = (list) => list.map((s) => (parseSmartScope(s) ? smartLabel(s) : s === 'smart' ? 'Smart Mining' : halls[s]?.name || s)).join(', ');
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
export async function ensureGuardDays(now = Date.now(), { detach = false } = {}) {
  await warm();
  const today = utcDay(now);
  const cur0 = metaGet('guarddays');
  if (cur0 && Number.isFinite(cur0.upto) && cur0.upto >= today - DAY) return 0;
  const settings = normalizeGuard(metaGet('guard'));
  const ends = await smartEnds();
  const halls = catalog().halls || {};
  const rates = Object.fromEntries(Object.entries(halls).map(([id, h]) => [id, hallRates(h)]));
  const refs = {};
  for (const r of (await q('SELECT symbol, ref_net FROM smart_coins')).rows) if (r.ref_net !== null) refs[r.symbol] = Number(r.ref_net);

  const out = await metaUpdate('guarddays', async (cur) => {
    if (!cur || !Number.isFinite(cur.upto)) return { value: { upto: today - DAY, paused: {}, smart: {} }, result: { n: 0 } };
    if (cur.upto >= today - DAY) return { result: { n: 0 } };
    const paused = { ...(cur.paused || {}) };
    const smart = { ...(cur.smart || {}) };
    const decided = [];
    let upto = cur.upto;
    let n = 0;
    const events = [];
    // The market of every day to decide, in two queries (not two per day).
    const [mkAll, cdAll] = await Promise.all([
      q('SELECT day, gross_per_th FROM market_days WHERE day >= $1 AND day <= $2', [upto + DAY, upto + MAX_CATCH_UP * DAY]),
      q('SELECT day, coin, net_per_rig FROM coin_days WHERE day >= $1 AND day <= $2 AND net_per_rig IS NOT NULL', [upto + DAY, upto + MAX_CATCH_UP * DAY]),
    ]);
    const grossOf = new Map(mkAll.rows.map((r) => [Number(r.day), Number(r.gross_per_th)]));
    const coinsOf = new Map();
    for (const r of cdAll.rows) {
      const list = coinsOf.get(Number(r.day));
      if (list) list.push(r);
      else coinsOf.set(Number(r.day), [r]);
    }
    for (let day = upto + DAY; day <= today - DAY && n < MAX_CATCH_UP; day += DAY, n += 1) {
      const before = new Set(paused[day - DAY] || []);
      const gross = grossOf.has(day) ? grossOf.get(day) : null;
      const ratios = (coinsOf.get(day) || []).map((r) => ratioOf(Number(r.net_per_rig), refs[r.coin])).filter((x) => Number.isFinite(x) && x > 0);
      const best = ratios.length ? Math.max(...ratios) : null;
      const off = decideDay({ gross, rates, settings, before });
      const added = off.filter((s) => !before.has(s));
      const gone = [...before].filter((s) => !off.includes(s));
      if (added.length || gone.length) events.push({ day, added, gone });
      if (off.length) paused[day] = off;
      // Smart Mining: keep the day's best ratio with the floor in force; paused when it is under the floor (replayed in lib/guard.js).

      if (settings.smartAuto && best !== null) smart[day] = [best, settings.smartFloor, settings.buffer, 1];
      decided.push(day);
      upto = day;
    }
    for (const d of Object.keys(paused)) if (Number(d) < today - KEEP_DAYS * DAY) delete paused[d];
    for (const d of Object.keys(smart)) if (Number(d) < today - KEEP_DAYS * DAY) delete smart[d];
    // What changed on the newest decided day, for the notifications (older days of a long catch-up are not announced).
    const was = new Set(paused[upto - DAY] || []);
    const is = new Set(paused[upto] || []);
    const changes = { paused: [...is].filter((s) => !was.has(s)), resumed: [...was].filter((s) => !is.has(s)) };
    // The log follows one Smart scope per term (the plans in between sit between them).
    for (const e of ends) {
      const set = smartReplay(smart, e.days, e.payout);
      for (const day of decided) {
        const a = set.has(day - DAY);
        const b = set.has(day);
        if (a === b) continue;
        let ev = events.find((x) => x.day === day);
        if (!ev) events.push((ev = { day, added: [], gone: [] }));
        (b ? ev.added : ev.gone).push(e.scope);
      }
    }
    events.sort((x, y) => x.day - y.day);
    return { value: { upto, paused, smart }, result: { n, last: upto, changes, smart, events: events.slice(-20) } };
  });
  // Logging and telling the owners touch every account (notifyChanges locks them in batches). A caller that may itself hold an
  // account lock, like guardState, must not wait for them: it would wait for a lock it holds. Direct callers (tests) wait.
  const after = async () => {
    if (out?.events) await logAuto(out.events).catch((e) => console.error('[guard] could not write the audit log:', e.message));
    if (out?.changes) await notifyChanges(out.changes, out.last, out.smart).catch((e) => console.error('[guard] could not notify:', e.message));
  };
  if (detach) void after();
  else await after();
  return out?.n ?? 0;
}

// What lib/earnings.js and lib/guard.js read as market.guard: { paused, smart, manual }. Decides any finished days first (and waits for
// that, so a day never shows as paid and then flips), at most once a minute when there is nothing due. Never throws.
// wait: false is for code that already holds an account lock (getMarket(c)): it starts the decision but does not wait for it, so
// a held lock and a held pool connection can never be what the decision is waiting on. Such callers warm getMarket() before the lock.
export async function guardState({ wait = true } = {}) {
  try {
    await warm();
    const cur = metaGet('guarddays');
    const due = !cur || !Number.isFinite(cur.upto) || cur.upto < utcDay(Date.now()) - DAY;
    if (due && !st.inflight && Date.now() - st.at >= RECHECK) {
      st.at = Date.now();
      st.inflight = ensureGuardDays(Date.now(), { detach: true })
        .catch((e) => console.error('[guard] could not decide the finished days:', e.message))
        .finally(() => {
          st.inflight = null;
        });
    }
    if (due && st.inflight && wait) await st.inflight;
  } catch (e) {
    console.error('[guard] state unavailable:', e.message);
  }
  return { paused: metaGet('guarddays')?.paused || {}, smart: metaGet('guarddays')?.smart || {}, manual: normalizeGuard(metaGet('guard')).manual };
}

// ---- Admin ----

const pct = (v, max) => {
  const n = Number(String(v ?? '').trim().replace(',', '.'));
  return Number.isFinite(n) && n >= 0 && n <= max * 100 ? Math.round(n * 100) / 10000 : null;
};
const flag = (v) => v !== false && v !== 'false';
// The Smart floor is typed as a ratio (0.5 = half of the anchor day). Left out or empty keeps `keep`; out of range gives null.
const floorOf = (v, keep) => {
  if (v === undefined || v === null || String(v).trim() === '') return keep;
  const n = Number(String(v).trim().replace(',', '.'));
  return Number.isFinite(n) && n >= 0 && n <= GUARD_LIMITS.smartFloor ? Math.round(n * 1000) / 1000 : null;
};

// Hands the paused-day rule to the miners already bought. A miner still inside its original term (start + days) takes `mode`: what
// it has been paid does not change, because inside that term a paused day pays nothing under either rule; only what a paused day does
// to its term end changes. A miner past that term keeps its rule, since the days after it were paid under it. Gift miners, which
// had no rule before, get one too. Safe to run again: a miner that already has the rule is left alone.
async function applyMode(mode) {
  const now = Date.now();
  const ids = (
    await q(`SELECT id FROM users WHERE CASE WHEN jsonb_typeof(data->'contracts') = 'array' THEN jsonb_array_length(data->'contracts') ELSE 0 END > 0 ORDER BY created_at, id`)
  ).rows.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 100) {
    await withUsers(ids.slice(i, i + 100), (map) => {
      for (const u of map.values()) {
        for (const c of u.contracts) {
          if (c.pauseRule === mode || !Number.isFinite(c.startedAt)) continue;
          if (now < c.startedAt + c.days * DAY) c.pauseRule = mode;
        }
      }
    });
  }
}

// Saves the automatic rules. margin and buffer arrive as percent (2 means 2%). The hand flips are kept as they are.
export async function saveGuardSettings(input) {
  await warm();
  const margin = pct(input?.margin, GUARD_LIMITS.margin);
  const buffer = pct(input?.buffer, GUARD_LIMITS.buffer);
  const smartFloor = floorOf(input?.smartFloor, normalizeGuard(metaGet('guard')).smartFloor);
  if (margin === null) return fail(422, `Profit margin must be between 0% and ${GUARD_LIMITS.margin * 100}%.`);
  if (buffer === null) return fail(422, `Buffer must be between 0% and ${GUARD_LIMITS.buffer * 100}%.`);
  if (smartFloor === null) return fail(422, `Smart floor must be between 0 and ${GUARD_LIMITS.smartFloor}.`);
  const value = { asicsAuto: flag(input?.asicsAuto), smartAuto: flag(input?.smartAuto), mode: input?.mode === 'zero' ? 'zero' : 'extend', margin, buffer, smartFloor };
  await metaUpdate('guard', (cur) => ({ value: { ...(cur || {}), ...value } }));
  await applyMode(value.mode).catch((e) => console.error('[guard] could not hand the rule to bought miners:', e.message));
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
  const smartFloor = floorOf(input?.smartFloor, saved.smartFloor);
  if (smartFloor === null) return fail(422, `Smart floor must be between 0 and ${GUARD_LIMITS.smartFloor}.`);
  const settings = {
    ...saved,
    asicsAuto: input?.asicsAuto === undefined ? saved.asicsAuto : flag(input.asicsAuto),
    smartAuto: input?.smartAuto === undefined ? saved.smartAuto : flag(input.smartAuto),
    margin,
    buffer,
    smartFloor,
  };
  const today = utcDay(Date.now());
  const from = today - BACKTEST_DAYS * DAY;
  const halls = catalog().halls || {};
  const rates = Object.fromEntries(Object.entries(halls).map(([id, h]) => [id, hallRates(h)]));
  const ends = await smartEnds();
  const [mk, cd, rf] = await Promise.all([
    q('SELECT day, gross_per_th FROM market_days WHERE day >= $1 AND day < $2', [from, today]),
    q('SELECT day, coin, net_per_rig FROM coin_days WHERE day >= $1 AND day < $2 AND net_per_rig IS NOT NULL', [from, today]),
    q('SELECT symbol, ref_net FROM smart_coins'),
  ]);
  const refs = {};
  for (const r of rf.rows) if (r.ref_net !== null) refs[r.symbol] = Number(r.ref_net);
  const gross = new Map(mk.rows.map((r) => [Number(r.day), Number(r.gross_per_th)]));
  const best = new Map();
  for (const r of cd.rows) {
    const x = ratioOf(Number(r.net_per_rig), refs[r.coin]);
    if (Number.isFinite(x) && x > 0) best.set(Number(r.day), Math.max(best.get(Number(r.day)) ?? 0, x));
  }
  const days = [];
  for (let day = from; day < today; day += DAY) days.push({ day, gross: gross.get(day) ?? null, best: best.get(day) ?? null });
  const paused = replayGuard(days, { rates, settings });
  const scope = (id, name) => ({ id, name, count: (paused[id] || []).length, days: paused[id] || [] });
  const smartScopes = ends.map((e) => {
    const list = replaySmart(days, { settings, scope: e.scope });
    return { id: e.scope, name: smartLabel(e.scope), count: list.length, days: list };
  });
  return {
    ...done,
    from,
    days: days.length,
    withData: days.filter((x) => x.gross !== null || x.best !== null).length,
    margin: Math.round(margin * 10000) / 100,
    buffer: Math.round(buffer * 10000) / 100,
    smartFloor,
    scopes: [...Object.entries(halls).map(([id, h]) => scope(id, h.name || id)), ...smartScopes],
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
  const ends = await smartEnds();
  // `as` is the scope the paused days are read from: hand flips are kept on 'smart' for every Smart plan, but the automatic
  // pauses belong to each plan's own scope, so the Smart row reads the plan that pauses first.
  const view = (id, name, as = id) => ({
    id,
    name,
    manual: manualState(s.manual, id, today),
    manualNext: manualState(s.manual, id, today + DAY),
    pausedToday: isPaused(g, as, today),
    pausedDays: Array.from({ length: HISTORY_DAYS }, (_, i) => today - i * DAY).filter((day) => isPaused(g, as, day)),
    lastPaused: parseSmartScope(as) ? smartPausedDays(g, as).slice(-1)[0] ?? null : Object.keys(g.paused || {}).map(Number).filter((d) => g.paused[d].includes(id)).sort((a, b) => b - a)[0] ?? null,
  });
  const scope = (id, name) => view(id, name);
  const smartView = {
    ...view('smart', 'Smart Mining', ends[0].scope),
    tiers: ends.map((e) => ({
      name: smartLabel(e.scope),
      pausedToday: isPaused(g, e.scope, today),
      pausedDays: Array.from({ length: HISTORY_DAYS }, (_, i) => today - i * DAY).filter((day) => isPaused(g, e.scope, day)),
      lastPaused: smartPausedDays(g, e.scope).slice(-1)[0] ?? null,
    })),
  };
  return {
    settings: { asicsAuto: s.asicsAuto, smartAuto: s.smartAuto, mode: s.mode, margin: Math.round(s.margin * 10000) / 100, buffer: Math.round(s.buffer * 10000) / 100, smartFloor: s.smartFloor },
    scopes: [...Object.entries(halls).map(([id, h]) => scope(id, h.name || id)), smartView],
  };
}
