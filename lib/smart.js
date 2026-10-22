// Smart Mining maths. Pure (no storage), so it runs on the server and in the browser.
//
// Each UTC day every coin has a market: how many USD one unit of hash power earns that day (gross). A coin's market is
// compared with its reference (the gross when Smart Mining was priced), which gives a ratio: 1 means as priced, 1.2 means the
// coin pays 20% more than priced. Because every coin is measured against its own reference, every coin carries the same margin.
// A day's coin is the one with the best ratio. It only changes when another coin beats the current one by more than the
// hysteresis, so the pick does not flip on tiny differences. The day then pays budget x base daily yield x that ratio.
export const HASH_UNIT = { 'H/s': 1, 'KH/s': 1e3, 'MH/s': 1e6, 'GH/s': 1e9, 'TH/s': 1e12 };
export const HYSTERESIS = 0.03;
const DAY_S = 86400;

// USD one unit of hash power earns in a day, before costs. Null when any input is missing or not positive.
export function grossPerUnit({ price, nethash, reward, blockTime, unit }) {
  const u = HASH_UNIT[unit];
  const ok = [price, nethash, reward, blockTime, u].every((v) => Number.isFinite(v) && v > 0);
  return ok ? (reward * (DAY_S / blockTime) * price * u) / nethash : null;
}

// A day's market against the coin's reference. Null when either is missing, so the coin is not eligible that day.
export function ratioOf(gross, ref) {
  return Number.isFinite(gross) && gross > 0 && Number.isFinite(ref) && ref > 0 ? gross / ref : null;
}

// The coin for a day. `ratios` is { SYMBOL: ratio | null }, `prev` the coin picked the day before (or null).
// Only coins with a ratio can be picked. The previous coin stays unless the best one beats it by more than `hysteresis`.
// Null when no coin has a ratio: the caller then pays at the reference (ratio 1) and keeps the last coin.
export function pickCoin(ratios, prev = null, hysteresis = HYSTERESIS) {
  let best = null;
  for (const [symbol, r] of Object.entries(ratios || {})) {
    if (r === null || !Number.isFinite(r) || r <= 0) continue;
    if (best === null || r > ratios[best]) best = symbol;
  }
  if (best === null) return null;
  const keep = prev && ratios[prev] > 0 && Number.isFinite(ratios[prev]);
  return keep && ratios[best] <= ratios[prev] * (1 + hysteresis) ? prev : best;
}

// The coin Smart Mining is on right now and its ratio, from { live: { COIN: gross }, refs, prev }. Null with no live data.
export function liveBest(sm) {
  const ratios = {};
  for (const [coin, g] of Object.entries(sm?.live || {})) ratios[coin] = ratioOf(g, sm.refs?.[coin]);
  const coin = pickCoin(ratios, sm?.prev ?? null);
  return coin ? { coin, ratio: ratios[coin] } : null;
}

// USD a budget earns on one day: budget x base daily yield (a fraction, 0.011 = 1.1% a day) x the picked coin's ratio.
export function dailyUsd(budget, baseYield, ratio = 1) {
  const ok = [budget, baseYield, ratio].every((v) => Number.isFinite(v) && v > 0);
  return ok ? budget * baseYield * ratio : 0;
}

// What a Smart Mining purchase looks like. The budget is the price, in whole dollars, on a 90, 120 or 150 day term.
// The payout is the NET profit a day as a fraction of the budget (0.003 = 0.3%) at the reference market. A term pays back
// the budget plus that profit every day, spread evenly: total = budget x (1 + payout x days), so the base yield is
// (1 + payout x days) / days a day. Every coin is measured against its own reference, so whichever coin is picked carries
// the same margin. The admin can change the payout between payoutMin and payoutMax; it only applies to purchases made
// afterwards (each miner keeps its own baseYield).
// Smoothing reserve (new purchases only): a day's profit is held inside a band of the miner's payout +/- 30% of that payout. Profit above the band goes
// into the miner's reserve, profit below it is topped up from the reserve, never beyond it. The reserve starts with a seed
// (seed x budget) funded by us. When the term ends the seed goes back to us and the rest is split: userShare to the user.
// `payout` is only the fallback for a miner or setting with no valid payout of its own. New purchases take theirs from the pay table below.
export const SMART = { min: 50, max: 10000, terms: [90, 120, 150], payout: 0.003, payoutMin: 0.001, payoutMax: 0.01, bandShare: 0.3, seed: 0.02, userShare: 0.5 };
export const validPayout = (p) => Number.isFinite(p) && p >= SMART.payoutMin && p <= SMART.payoutMax;
export const smartBaseYield = (days, payout = SMART.payout) => (1 + (validPayout(payout) ? payout : SMART.payout) * days) / days;

// The pay table. The net profit a day depends on the budget and the term: a 90 day purchase pays the rate of its budget, read from
// these waypoints and interpolated on the log of the budget between two of them (flat above the last); a longer term adds a small
// bonus. The admin edits the ten rates and the two bonuses (SMART_BONUS_MAX at most); anything invalid falls back to the defaults.
// A payout is a multiple of 0.001% a day, which is how the profit guard tells payouts apart (lib/guard.js smartScope).
export const SMART_BUDGETS = [50, 100, 200, 350, 500, 1000, 2000, 3500, 5000, 10000];
export const SMART_RATES = [0.0021, 0.00235, 0.0026, 0.0028, 0.00295, 0.00315, 0.0034, 0.0036, 0.00375, 0.004];
export const SMART_BONUS = { 90: 0, 120: 0.0001, 150: 0.0002 };
export const SMART_BONUS_MAX = 0.005;
export const SMART_TABLE = { rates: SMART_RATES, bonus: SMART_BONUS };

// A saved pay table (or nothing) as { rates: [10 fractions], bonus: { 90: 0, 120, 150 } }.
export function normalizeSmartTable(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const okRates = Array.isArray(r.rates) && r.rates.length === SMART_BUDGETS.length && r.rates.every((v) => v !== null && v !== '' && validPayout(Number(v)));
  const b = r.bonus && typeof r.bonus === 'object' ? r.bonus : {};
  const bonus = (k) => {
    const v = Number(b[k]);
    return b[k] !== null && b[k] !== undefined && b[k] !== '' && Number.isFinite(v) && v >= 0 && v <= SMART_BONUS_MAX ? v : SMART_BONUS[k];
  };
  return { rates: okRates ? r.rates.map(Number) : [...SMART_RATES], bonus: { 90: 0, 120: bonus(120), 150: bonus(150) } };
}

// The net profit a day (a fraction of the budget) for a budget and a term, from the pay table (the default one when none is given).
export function smartPayout(budget, days, table) {
  const { rates, bonus } = normalizeSmartTable(table);
  const b = Math.min(SMART.max, Math.max(SMART.min, Number(budget) || SMART.min));
  let base = rates[rates.length - 1];
  for (let i = 0; i < SMART_BUDGETS.length - 1; i += 1) {
    const lo = SMART_BUDGETS[i];
    const hi = SMART_BUDGETS[i + 1];
    if (b <= hi) {
      const t = (Math.log(b) - Math.log(lo)) / (Math.log(hi) - Math.log(lo));
      base = rates[i] + (rates[i + 1] - rates[i]) * Math.max(0, Math.min(1, t));
      break;
    }
  }
  const p = Math.min(SMART.payoutMax, Math.max(SMART.payoutMin, base + (bonus[days] ?? 0)));
  return Math.round(p * 1e5) / 1e5;
}

// The reserve terms stored on a Smart Mining miner: lo and hi are the band as fractions of the budget a day, seed in USD.
export function smartReserve(budget, payout = SMART.payout) {
  const p = validPayout(payout) ? payout : SMART.payout;
  const r8 = (v) => Math.round(v * 1e8) / 1e8;
  return { lo: r8(p * (1 - SMART.bandShare)), hi: r8(p * (1 + SMART.bandShare)), seed: Math.round(budget * SMART.seed * 100) / 100, userShare: SMART.userShare };
}

// What a miner pays on each of its days with the reserve at work. c = { budget, days, baseYield, reserve }, ratios[i] is the
// picked coin's ratio on day i (0 = first UTC day). weights[i] is how much of day i falls inside the term (1 for a whole day;
// the first and last UTC day of a term are part days, and the weights add up to c.days). Returns { days: [usd per day],
// left: reserve after the last day given }. A miner without a reserve (bought before it existed) pays budget x baseYield x
// ratio x weight, as before. off[i] true means day i is paused by the profit guard (lib/guard.js): it pays nothing and the
// reserve is not touched.
export function smartSeries(c, ratios, weights = null, off = null) {
  const out = [];
  const r = c.reserve;
  let left = r ? r.seed : 0;
  for (let i = 0; i < ratios.length; i += 1) {
    if (off?.[i]) {
      out.push(0);
      continue;
    }
    const w = weights ? weights[i] : 1;
    const raw = dailyUsd(c.budget, c.baseYield, ratios[i]) * w;
    if (!r) {
      out.push(raw);
      continue;
    }
    const share = (c.budget / c.days) * w;
    const profit = raw - share;
    const lo = c.budget * r.lo * w;
    const hi = c.budget * r.hi * w;
    if (profit > hi) {
      left += profit - hi;
      out.push(share + hi);
    } else if (profit < lo) {
      const top = Math.min(lo - profit, left);
      left -= top;
      out.push(raw + top);
    } else out.push(raw);
  }
  return { days: out, left };
}

// What is left in the reserve when the term ends: the seed returns to us first, the rest is split.
export function smartSettle(c, left) {
  const r = c.reserve;
  if (!r) return { user: 0, us: 0 };
  const back = Math.min(r.seed, left);
  const extra = Math.max(0, left - back);
  return { user: extra * r.userShare, us: back + extra * (1 - r.userShare) };
}

// `table` is the pay table (or nothing for the default one); a plain number is taken as the payout itself.
export function smartPlan(budget, days, table) {
  const raw = typeof table === 'number' ? table : smartPayout(budget, days, table);
  const payout = validPayout(raw) ? raw : SMART.payout;
  const daily = dailyUsd(budget, smartBaseYield(days, payout), 1);
  return {
    id: 'smart',
    name: 'Smart Mining',
    th: 0,
    days,
    hall: 'smart',
    price: budget,
    smart: true,
    budget,
    baseYield: smartBaseYield(days, payout),
    reserve: smartReserve(budget, payout),
    daily: `$${daily.toFixed(2)}`,
    blurb: 'Pick a budget and a term. We pick the most profitable coin for you every day.',
  };
}

// Null when the budget or term is not allowed.
export function resolveSmart(input, table) {
  const budget = Number(input?.budget);
  const days = Number(input?.days);
  if (!Number.isInteger(budget) || budget < SMART.min || budget > SMART.max || !SMART.terms.includes(days)) return null;
  return smartPlan(budget, days, table);
}
