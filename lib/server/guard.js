// Profit guard, server side. Rules and maths are in lib/guard.js; this file stores them.
//
//   meta "guard"      the admin's settings and hand flips: { asicsAuto, smartAuto, mode, margin, buffer, manual }
//   meta "guarddays"  { upto, paused: { [utcMidnightMs]: [scope] } }: the automatic decisions, one per finished UTC day,
//                     written once from that day's final market and then locked (a paid day never changes). `upto` is the
//                     last day decided. The first run starts at yesterday, so nothing is decided backwards in time.
// A change reaches every server within a few seconds (the meta cache). Settings only ever apply to days not yet decided.
import { q, warm, metaGet, metaUpdate, catalog } from '@/lib/server/db';
import { DAY, GUARD_LIMITS, normalizeGuard, manualState, isPaused, autoPaused, profitShareAsic, profitShareSmart } from '@/lib/guard';
import { hallRates } from '@/lib/fees';
import { ratioOf } from '@/lib/smart';
import { smartSettings } from '@/lib/server/smart-admin';

const MAX_CATCH_UP = 400;
const KEEP_DAYS = 800;
const RECHECK = 60_000;
const utcDay = (t) => Math.floor(t / DAY) * DAY;
const fail = (status, error) => ({ ok: false, status, error });
const done = { ok: true, status: 200 };
const st = (globalThis.__opusGuard ||= { at: 0, inflight: null });

// The settings with defaults and limits applied.
export async function guardSettings() {
  await warm();
  return normalizeGuard(metaGet('guard'));
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
  const refs = {};
  for (const r of (await q('SELECT symbol, ref_gross FROM smart_coins')).rows) if (r.ref_gross !== null) refs[r.symbol] = Number(r.ref_gross);

  return metaUpdate('guarddays', async (cur) => {
    if (!cur || !Number.isFinite(cur.upto)) return { value: { upto: today - DAY, paused: {} }, result: 0 };
    if (cur.upto >= today - DAY) return { result: 0 };
    const paused = { ...(cur.paused || {}) };
    let upto = cur.upto;
    let n = 0;
    for (let day = upto + DAY; day <= today - DAY && n < MAX_CATCH_UP; day += DAY, n += 1) {
      const before = new Set(paused[day - DAY] || []);
      const [mk, cd] = await Promise.all([
        q('SELECT gross_per_th FROM market_days WHERE day = $1', [day]),
        q('SELECT coin, gross_per_unit FROM coin_days WHERE day = $1', [day]),
      ]);
      const gross = mk.rows[0] ? Number(mk.rows[0].gross_per_th) : null;
      const off = [];
      if (settings.asicsAuto && gross > 0) {
        for (const [id, hall] of Object.entries(halls)) {
          if (autoPaused(profitShareAsic(gross, hallRates(hall)), before.has(id), settings.margin, settings.buffer)) off.push(id);
        }
      }
      if (settings.smartAuto) {
        const ratios = cd.rows.map((r) => ratioOf(Number(r.gross_per_unit), refs[r.coin])).filter((x) => Number.isFinite(x) && x > 0);
        const best = ratios.length ? Math.max(...ratios) : null;
        if (autoPaused(best === null ? null : profitShareSmart(best, payout), before.has('smart'), settings.margin, settings.buffer)) off.push('smart');
      }
      if (off.length) paused[day] = off;
      upto = day;
    }
    for (const d of Object.keys(paused)) if (Number(d) < today - KEEP_DAYS * DAY) delete paused[d];
    return { value: { upto, paused }, result: n };
  });
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

// For the admin card: the settings (margin and buffer in percent) and, for each scope, its hand setting and whether it is
// paused today and tomorrow.
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
    lastPaused: Object.keys(g.paused || {}).map(Number).filter((d) => g.paused[d].includes(id)).sort((a, b) => b - a)[0] ?? null,
  });
  return {
    settings: { asicsAuto: s.asicsAuto, smartAuto: s.smartAuto, mode: s.mode, margin: Math.round(s.margin * 10000) / 100, buffer: Math.round(s.buffer * 10000) / 100 },
    scopes: [...Object.entries(halls).map(([id, h]) => scope(id, h.name || id)), scope('smart', 'Smart Mining')],
  };
}
