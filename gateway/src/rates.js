// USD rates for pricing invoices. Fails closed: with no fresh rate there is no invoice (a stale or made-up
// price could underprice an order), unlike the app's display prices which fall back to static ones.
import { config } from './config.js';

const IDS = { btc: 'bitcoin' };
const FRESH = 30_000;
const MAX_AGE = 300_000;
const cache = new Map();
const inflight = new Map();

async function fetchRate(asset) {
  const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${IDS[asset]}&vs_currencies=usd`, {
    signal: AbortSignal.timeout(4000),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`rate feed ${res.status}`);
  const v = (await res.json())?.[IDS[asset]]?.usd;
  if (typeof v !== 'number' || !(v > 0)) throw new Error('empty rate feed');
  return v;
}

export async function usdRate(asset) {
  const cfg = config();
  if (cfg.rateSource === 'static') {
    if (asset === 'btc' && cfg.staticBtcUsd > 0) return cfg.staticBtcUsd;
    throw new Error('No rate available.');
  }
  if (!IDS[asset]) throw new Error(`No rate source for ${asset}.`);
  const now = Date.now();
  const hit = cache.get(asset);
  if (hit && now - hit.at < FRESH) return hit.usd;
  try {
    if (!inflight.has(asset)) inflight.set(asset, fetchRate(asset).finally(() => inflight.delete(asset)));
    const usd = await inflight.get(asset);
    cache.set(asset, { usd, at: Date.now() });
    return usd;
  } catch (e) {
    if (hit && now - hit.at < MAX_AGE) return hit.usd;
    throw e;
  }
}
