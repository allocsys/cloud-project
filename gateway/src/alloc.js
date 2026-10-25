// Unique amounts for networks where every invoice pays the SAME address (fixed-address mode).
// The invoice amount is rounded up to a small step (a power of ten) and then nudged up by whole steps until no other
// invoice on that address and asset expects the same amount. The payer sends that exact amount; the watcher matches on it.
// The extra cost to the payer stays under one cent: slots x step.

export const STABLES = new Set(['usdt', 'usdc']);

// Step size in USD and how many steps are tried. Stablecoins: 0.0001 x 100. Everything else: 0.0002 x 50.
export function quantumRule(asset) {
  return STABLES.has(asset) ? { usd: 0.0001, slots: 100 } : { usd: 0.0002, slots: 50 };
}

// The step in atomic units: the largest power of ten that is not bigger than usdStep worth of the asset (at least 1).
export function quantumAtomic(usdStep, rate, decimals) {
  const raw = Math.floor((usdStep / rate) * 10 ** decimals);
  if (!(raw >= 1)) return 1n;
  return 10n ** BigInt(BigInt(raw).toString().length - 1);
}

// base and quantum are BigInt; taken is a Set of decimal strings. Returns the first free amount, or null when all slots are used.
export function pickAmount(base, quantum, taken, slots) {
  const start = ((base + quantum - 1n) / quantum) * quantum;
  for (let k = 0; k < slots; k++) {
    const c = start + BigInt(k) * quantum;
    if (!taken.has(c.toString())) return c;
  }
  return null;
}
