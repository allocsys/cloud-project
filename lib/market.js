// What one TH/s earns, worked out from the live market. Pure (no network, no storage).
//
//   gross USD per TH/s per day = block reward x blocks a TH/s finds per day x BTC price
//   blocks a TH/s finds per day = 1e12 x 86400 / (difficulty x 2^32)
//   net = gross - the hall's electricity - maintenance, never below zero (see lib/fees.js)
//
// Only the block subsidy is counted, not transaction fees: the safer side for the customer-facing estimate.
// The static fallback (GROSS_PER_TH_DAY in lib/fees.js, BTC_USD in lib/data.js) is what is used when no market data exists.
import { hallRates } from '@/lib/fees';

export const SUBSIDY_BTC = 3.125; // per block, since the April 2024 halving (the next one is due around 2028)
const TWO32 = 4294967296;

// A real Bitcoin difficulty is around 1e14. Anything outside this range is a bad reading and is ignored.
export const validDifficulty = (d) => Number.isFinite(d) && d > 1e12 && d < 1e17;

// BTC mined by one TH/s in a day.
export const btcPerThDay = (difficulty) => (SUBSIDY_BTC * 86400 * 1e12) / (difficulty * TWO32);

// USD per TH/s per day, before costs.
export const grossPerThDay = (difficulty, btcUsd) => btcPerThDay(difficulty) * btcUsd;

// USD per TH/s per day after the hall's electricity and maintenance. Null when the hall's numbers are not stated.
export function netPerThDay(gross, hall) {
  const r = hallRates(hall);
  return r ? Math.max(0, gross - r.elec - r.maint) : null;
}

// What a plan is expected to pay per day right now, in USD: th x net rate. Null when there is no market or no hall rates.
export function liveDaily(th, hall, live) {
  if (!live) return null;
  const net = netPerThDay(live.gross, hall);
  return net === null ? null : th * net;
}
