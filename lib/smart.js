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

// USD a budget earns on one day: budget x base daily yield (a fraction, 0.011 = 1.1% a day) x the picked coin's ratio.
export function dailyUsd(budget, baseYield, ratio = 1) {
  const ok = [budget, baseYield, ratio].every((v) => Number.isFinite(v) && v > 0);
  return ok ? budget * baseYield * ratio : 0;
}
