// Smart Mining settings the admin can change, and the coin list. Settings live in the meta entry "smart"
// { enabled, rates, bonus }; a change reaches every server within a few seconds (the meta cache).
//
//   enabled   Smart Mining can be bought. Off hides it from the Plans screen and refuses new purchases; miners already
//             running keep paying.
//   rates     the net profit a day at the reference market, as fractions of the budget, for a 90 day term at the ten budget
//             waypoints of lib/smart.js (SMART_BUDGETS); in between, the rate follows the log of the budget.
//   bonus     what a 120, 150 and 180 day term add to that rate: { 120, 150, 180 }.
//             Together they are the pay table (lib/smart.js smartPayout). It only applies to purchases made afterwards: every
//             miner keeps the baseYield and reserve it was bought with. A saved entry that is missing or invalid falls back to the defaults.
//   anchorFloors  the lowest the rolling anchor may be (lib/smart.js), as a history [{ from, floor }]. A saved floor starts on the next UTC
//             day, so a finished day keeps the floor it was decided and paid under. None saved = ANCHOR_FLOOR ($1.00).
//   coins     smart_coins rows. A coin can be turned off (never picked again) but the last enabled one stays on. A coin's
//             reference is never reset here: finished days are worked out against it, so resetting it would change what
//             past days paid.
//   halls     the three Smart halls (lib/smart-halls.js: ASIC, GPU, CPU). The admin edits their details (name, place, power,
//             rig, and the ASIC hall's efficiency); the hall ids, kinds and which coin runs where are fixed. Edits live in the
//             meta entry "smarthalls" { [id]: details } and are laid over the defaults; Reset deletes the entry.
import { q, tx, warm, metaGet, metaUpdate, metaDelete } from '@/lib/server/db';
import { SMART, SMART_BUDGETS, SMART_BONUS_MAX, ANCHOR_DAYS, ANCHOR_FLOOR_MIN, ANCHOR_FLOOR_MAX, anchorOn, seedOf, normalizeSmartTable, validPayout, normalizeFloors, floorOn } from '@/lib/smart';
import { SMART_HALLS, mergeSmartHalls, smartHallFields } from '@/lib/smart-halls';
import { recordCoins } from '@/lib/server/smart-market';

const fail = (status, error) => ({ ok: false, status, error });
const done = { ok: true, status: 200 };

// { enabled, table: { rates: [10], bonus: { 90: 0, 120, 150, 180 } } }, with defaults for anything missing or invalid.
export async function smartSettings() {
  await warm();
  const s = metaGet('smart') || {};
  const floors = normalizeFloors(s.anchorFloors);
  const now = Date.now();
  return { enabled: s.enabled !== false, kwhAuto: s.kwhAuto !== false, table: normalizeSmartTable(s), floors, anchorFloor: floorOn(now, floors), anchorFloorNext: floorOn(Math.floor(now / 86400000) * 86400000 + 86400000, floors) };
}

const fraction = (v) => (v === null || v === undefined || String(v).trim() === '' ? NaN : Number(String(v).trim().replace(',', '.')));
const r5 = (v) => Math.round(v * 1e5) / 1e5;

// Saves the on/off switch and, when they are given, the ten rates and the bonus (all as fractions: 0.003 is 0.3%). What is left
// out stays as it is, so the switch can be flipped on its own.
export async function saveSmartSettings(input) {
  const enabled = input?.enabled !== false && input?.enabled !== 'false';
  const patch = {};
  if (input?.kwhAuto !== undefined) patch.kwhAuto = input.kwhAuto !== false && input.kwhAuto !== 'false';
  if (input?.rates !== undefined) {
    const list = Array.isArray(input.rates) ? input.rates.map(fraction) : [];
    if (list.length !== SMART_BUDGETS.length || !list.every((v) => validPayout(v))) return fail(422, `Net profit a day must be between ${SMART.payoutMin * 100}% and ${SMART.payoutMax * 100}% for every budget.`);
    patch.rates = list.map(r5);
  }
  if (input?.bonus !== undefined) {
    const b = input.bonus && typeof input.bonus === 'object' ? input.bonus : {};
    const long = [fraction(b[120]), fraction(b[150]), fraction(b[180])];
    if (!long.every((v) => Number.isFinite(v) && v >= 0 && v <= SMART_BONUS_MAX)) return fail(422, `The bonus for a longer term must be between 0% and ${SMART_BONUS_MAX * 100}%.`);
    patch.bonus = { 120: r5(long[0]), 150: r5(long[1]), 180: r5(long[2]) };
  }
  // The anchor floor (USD a day) starts tomorrow (UTC), so no day already decided or paid changes.
  let floor = null;
  if (input?.anchorFloor !== undefined) {
    floor = fraction(input.anchorFloor);
    if (!(floor >= ANCHOR_FLOOR_MIN && floor <= ANCHOR_FLOOR_MAX)) return fail(422, `Anchor floor must be between $${ANCHOR_FLOOR_MIN} and $${ANCHOR_FLOOR_MAX} a day.`);
    floor = Math.round(floor * 100) / 100;
  }
  const from = Math.floor(Date.now() / 86400000) * 86400000 + 86400000;
  await metaUpdate('smart', (cur) => {
    const value = { ...(cur || {}), enabled: input?.enabled === undefined && cur ? cur.enabled !== false : enabled, ...patch };
    if (floor !== null) value.anchorFloors = [...normalizeFloors(cur?.anchorFloors).filter((e) => e.from < from), { from, floor }].slice(-50);
    return { value };
  });
  // Flipping the electricity price switch rewrites today's rows now instead of waiting for the next five minute tick.
  if (patch.kwhAuto !== undefined) await recordCoins().catch((e) => console.error('[smart] re-record failed:', e.message));
  return { ...done, enabled, ...patch, ...(floor !== null ? { anchorFloor: floor, from } : {}) };
}

// The Smart halls as they are now (defaults with the admin's edits laid over), as { [id]: { name, place, power, rig, kind, ... } }.
export async function smartHallList() {
  await warm();
  return mergeSmartHalls(metaGet('smarthalls'));
}

// Saves the details of one Smart hall. Every editable field must be filled in, and no two halls may share a name.
export async function saveSmartHall(input) {
  const id = String(input?.id ?? '');
  if (!Object.hasOwn(SMART_HALLS, id)) return fail(404, 'Hall not found.');
  const d = input?.hall ?? {};
  const hall = {};
  for (const [k, max] of Object.entries(smartHallFields(id))) {
    const v = String(d[k] ?? '').trim();
    if (!v) return fail(422, 'Fill in every field.');
    hall[k] = v.slice(0, max);
  }
  return metaUpdate('smarthalls', (cur) => {
    const next = { ...(cur || {}), [id]: hall };
    const halls = mergeSmartHalls(next);
    const names = Object.values(halls).map((h) => h.name.toLowerCase());
    if (new Set(names).size !== names.length) return { result: fail(409, 'Another Smart hall already has this name.') };
    return { value: next, result: done };
  });
}

// Back to the built-in Smart halls.
export async function resetSmartHalls() {
  await metaDelete('smarthalls');
  return done;
}

// Every coin with the anchor, its reference rig, today's net profit and how many days of market data it has.
export async function smartCoinList() {
  const r = await q(
    `SELECT c.symbol, c.name, c.algo, c.kind, c.unit, c.enabled, c.ref_net, c.rig_hash, c.rig_watts, c.kwh_usd,
            (SELECT count(*)::int FROM coin_days d WHERE d.coin = c.symbol) AS days,
            (SELECT d.net_per_rig FROM coin_days d WHERE d.coin = c.symbol ORDER BY d.day DESC LIMIT 1) AS net
       FROM smart_coins c ORDER BY c.sort, c.symbol`,
  );
  const num = (v) => (v === null || v === undefined ? null : Number(v));
  return r.rows.map((x) => ({
    symbol: x.symbol,
    name: x.name,
    algo: x.algo,
    kind: x.kind,
    unit: x.unit,
    enabled: !!x.enabled,
    ref: num(x.ref_net),
    rigHash: num(x.rig_hash),
    rigWatts: num(x.rig_watts),
    kwh: num(x.kwh_usd),
    net: num(x.net),
    days: x.days,
  }));
}

// The last days of market data, newest first: { day, nets: { [symbol]: net per rig in USD }, pick, best, anchor }. pick is the coin
// locked in smart_picks for a finished day (null while the day is still running); best is the coin with the highest net that day;
// anchor is the anchor that day is measured against (lib/smart.js anchorOn: the seed before 28 Oct 2026, then the rolling one).
export async function smartDayTable(limit = 14) {
  const r = await q(
    `SELECT d.day, d.coin, d.net_per_rig AS net, p.coin AS pick
       FROM coin_days d LEFT JOIN smart_picks p ON p.day = d.day
      WHERE d.day IN (SELECT DISTINCT day FROM coin_days ORDER BY day DESC LIMIT $1)
      ORDER BY d.day DESC`,
    [Math.max(1, Math.min(60, Number(limit) || 14))],
  );
  const first = r.rows.reduce((m, x) => Math.min(m, Number(x.day)), Infinity);
  const seed = seedOf(Object.fromEntries((await q('SELECT symbol, ref_net FROM smart_coins WHERE ref_net IS NOT NULL')).rows.map((x) => [x.symbol, Number(x.ref_net)])));
  const { floors } = await smartSettings();
  const back = Number.isFinite(first) ? (await q('SELECT day, coin, net_per_rig FROM coin_days WHERE day >= $1 AND net_per_rig IS NOT NULL', [first - ANCHOR_DAYS * 86400000])).rows : [];
  const netDays = {};
  for (const x of back) (netDays[Number(x.day)] ||= {})[x.coin] = Number(x.net_per_rig);
  const byDay = new Map();
  for (const x of r.rows) {
    const day = Number(x.day);
    const row = byDay.get(day) || { day, nets: {}, pick: x.pick || null, best: null };
    row.nets[x.coin] = x.net === null || x.net === undefined ? null : Number(x.net);
    byDay.set(day, row);
  }
  const rows = [...byDay.values()];
  for (const row of rows) {
    let top = null;
    for (const [sym, n] of Object.entries(row.nets)) if (n !== null && (top === null || n > row.nets[top])) top = sym;
    row.best = top;
    row.anchor = anchorOn(row.day, netDays, seed, floors);
  }
  return rows;
}

// Saves a coin's reference rig: hashrate in the coin's own unit, power in watts and the price of a kWh in USD. Only new readings
// use it: net profit already recorded for a day is never rewritten.
export async function setSmartCoinRig(symbol, input) {
  const sym = String(symbol ?? '').toUpperCase();
  const hash = fraction(input?.rigHash);
  const watts = fraction(input?.rigWatts);
  const kwh = fraction(input?.kwh);
  if (!(hash > 0 && hash < 1e9)) return fail(422, 'Rig hashrate must be more than 0.');
  if (!(watts >= 0 && watts <= 1e6)) return fail(422, 'Rig power must be between 0 and 1,000,000 W.');
  if (!(kwh >= 0 && kwh <= 5)) return fail(422, 'Electricity must be between $0 and $5 per kWh.');
  const r = await q('UPDATE smart_coins SET rig_hash = $2, rig_watts = $3, kwh_usd = $4 WHERE symbol = $1', [sym, hash, watts, kwh]);
  if (!r.rowCount) return fail(404, 'Coin not found.');
  return { ...done, symbol: sym, rigHash: hash, rigWatts: watts, kwh };
}

export async function setSmartCoin(symbol, enabled) {
  const sym = String(symbol ?? '').toUpperCase();
  const on = enabled === true || enabled === 'true';
  // All coin rows are locked in symbol order, so two admins turning off different coins queue up and the second one sees
  // the first one's change before it counts what is left.
  return tx(async (c) => {
    const rows = (await q('SELECT symbol, enabled FROM smart_coins ORDER BY symbol FOR UPDATE', [], c)).rows;
    if (!rows.some((x) => x.symbol === sym)) return fail(404, 'Coin not found.');
    if (!on && !rows.some((x) => x.enabled && x.symbol !== sym)) return fail(409, 'Keep at least one coin on.');
    await q('UPDATE smart_coins SET enabled = $2 WHERE symbol = $1', [sym, on], c);
    return { ...done, symbol: sym, enabled: on };
  });
}
