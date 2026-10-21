// Smart Mining settings the admin can change, and the coin list. Settings live in the meta entry "smart"
// { enabled, payout }; a change reaches every server within a few seconds (the meta cache).
//
//   enabled   Smart Mining can be bought. Off hides it from the Plans screen and refuses new purchases; miners already
//             running keep paying.
//   payout    what a term pays back at the reference market, as a multiple of the budget (lib/smart.js, 1.06 by default).
//             It only applies to purchases made afterwards: every miner keeps the baseYield it was bought with.
//   coins     smart_coins rows. A coin can be turned off (never picked again) but the last enabled one stays on. A coin's
//             reference is never reset here: finished days are worked out against it, so resetting it would change what
//             past days paid.
import { q, warm, metaGet, metaUpdate } from '@/lib/server/db';
import { SMART, validPayout } from '@/lib/smart';

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
  if (!validPayout(payout)) return fail(422, `Payout must be between ${SMART.payoutMin} and ${SMART.payoutMax}.`);
  const value = { enabled, payout: Math.round(payout * 1000) / 1000 };
  await metaUpdate('smart', (cur) => ({ value: { ...(cur || {}), ...value } }));
  return { ...done, ...value };
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
