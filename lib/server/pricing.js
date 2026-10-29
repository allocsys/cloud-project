// The live gross hashprice that ASICs power prices follow, sampled at most once an hour and kept when the feed fails.
// A price is locked when a purchase is made (it is stored on the miner or the order), so a later change never touches it.
// With no live market at all (PRICE_FEED=static, or the feed never answered) prices fall back to the saved hall rates.
import { getLive } from '@/lib/server/market';
import { priceHalls, PRICE_REFRESH_MS } from '@/lib/pricing';

const state = (globalThis.__vtxPricing ||= { gross: null, at: 0, inflight: null });

// Re-reads the live gross when the last reading is an hour old. Never throws: on a failed read the last good one stays.
export async function refreshPricing() {
  if (state.gross !== null && Date.now() - state.at < PRICE_REFRESH_MS) return state.gross;
  if (!state.inflight) {
    state.inflight = getLive()
      .then((live) => {
        if (live && live.gross > 0) {
          state.gross = live.gross;
          state.at = Date.now();
        }
      })
      .catch((e) => console.error('[pricing] live gross unavailable:', e.message))
      .finally(() => {
        state.inflight = null;
      });
  }
  await state.inflight;
  return state.gross;
}

// The gross prices follow right now, or null before the first good reading.
export const pricingGross = () => state.gross;

// The halls with live-linked net rates (the saved ones until there is a reading). Call refreshPricing() first.
export const pricedHalls = (halls) => priceHalls(halls, state.gross);
