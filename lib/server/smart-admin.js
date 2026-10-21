// Smart Mining settings the admin can change, and the coin list. Settings live in the meta entry "smart"
// { enabled, payout }; a change reaches every server within a few seconds (the meta cache).
//
//   enabled   Smart Mining can be bought. Off hides it from the Plans screen and refuses new purchases; miners already
//             running keep paying.
//   payout    the net profit a day at the reference market, as a fraction of the budget (lib/smart.js, 0.003 = 0.3% by default).
//             It only applies to purchases made afterwards: every miner keeps the baseYield and reserve it was bought with.
//   coins     smart_coins rows. A coin can be turned off (never picked again) but the last enabled one stays on. A coin's
//             reference is never reset here: finished days are worked out against it, so resetting it would change what
//             past days paid.
//   halls     the three Smart halls (lib/smart-halls.js: ASIC, GPU, CPU). The admin edits their details (name, place, power,
//             rig, and the ASIC hall's efficiency); the hall ids, kinds and which coin runs where are fixed. Edits live in the
//             meta entry "smarthalls" { [id]: details } and are laid over the defaults; Reset deletes the entry.
import { q, warm, metaGet, metaUpdate, metaDelete } from '@/lib/server/db';
import { SMART, validPayout } from '@/lib/smart';
import { SMART_HALLS, mergeSmartHalls, smartHallFields } from '@/lib/smart-halls';

const fail = (status, error) => ({ ok: false, status, error });
const done = { ok: true, status: 200 };

export async function smartSettings() {
  await warm();
  const s = metaGet('smart') || {};
  return { enabled: s.enabled !== false, payout: validPayout(Number(s.payout)) ? Number(s.payout) : SMART.payout };
}

export async function saveSmartSettings(input) {
  const enabled = input?.enabled !== false && input?.enabled !== 'false';
  const payout = Number(String(input?.payout ?? '').trim().replace(',', '.'));
  if (!validPayout(payout)) return fail(422, `Net profit a day must be between ${SMART.payoutMin * 100}% and ${SMART.payoutMax * 100}%.`);
  const value = { enabled, payout: Math.round(payout * 10000) / 10000 };
  await metaUpdate('smart', (cur) => ({ value: { ...(cur || {}), ...value } }));
  return { ...done, ...value };
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

// Every coin with its reference and how many days of market data it has.
export async function smartCoinList() {
  const r = await q(
    `SELECT c.symbol, c.name, c.algo, c.kind, c.unit, c.enabled, c.ref_gross,
            (SELECT count(*)::int FROM coin_days d WHERE d.coin = c.symbol) AS days
       FROM smart_coins c ORDER BY c.sort, c.symbol`,
  );
  return r.rows.map((x) => ({ symbol: x.symbol, name: x.name, algo: x.algo, kind: x.kind, unit: x.unit, enabled: !!x.enabled, ref: x.ref_gross === null ? null : Number(x.ref_gross), days: x.days }));
}

export async function setSmartCoin(symbol, enabled) {
  const sym = String(symbol ?? '').toUpperCase();
  const on = enabled === true || enabled === 'true';
  const cur = (await q('SELECT enabled FROM smart_coins WHERE symbol = $1', [sym])).rows[0];
  if (!cur) return fail(404, 'Coin not found.');
  if (!on) {
    const others = (await q('SELECT count(*)::int AS n FROM smart_coins WHERE enabled AND symbol <> $1', [sym])).rows[0].n;
    if (!others) return fail(409, 'Keep at least one coin on.');
  }
  await q('UPDATE smart_coins SET enabled = $2 WHERE symbol = $1', [sym, on]);
  return { ...done, symbol: sym, enabled: on };
}
