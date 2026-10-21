// Server-side price cache. One refresh at a time, shared by every request.
//   fresh (< 30 s): served straight from memory
//   stale (< 5 min): served from memory while one background refresh runs
//   older, or never fetched: wait for the refresh
// If the feed fails we keep the last prices (or the static ones) and retry in a few seconds.
// Set PRICE_FEED=static to turn the live feed off.
import { DEFAULT_PRICES } from '@/lib/assets';

const IDS = { btc: 'bitcoin', eth: 'ethereum', bnb: 'binancecoin', trx: 'tron', usdt: 'tether', ton: 'the-open-network' };
// Extended cache TTLs for performance optimization
// FRESH: serve from cache without refresh (60s -> reduces API calls)
// STALE: serve from cache while refreshing in background (5min -> reduces load)
const FRESH = 60_000; // 1 minute - reduced external API calls
const STALE = 300_000; // 5 minutes
const RETRY = 5_000;
const TREND_EVERY = 300_000;
// Maximum retry attempts for price feed
const MAX_RETRIES = 3;
const RETRY_BACKOFF = [1000, 3000, 5000]; // Exponential backoff in ms

const state = (globalThis.__opusPrices ||= { prices: { ...DEFAULT_PRICES }, at: 0, source: 'static', inflight: null });

async function fetchLive(attempt = 0) {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${Object.values(IDS).join(',')}&vs_currencies=usd`;
  
  try {
    const res = await fetch(url, { 
      signal: AbortSignal.timeout(3000 + RETRY_BACKOFF[attempt] || 0), 
      cache: 'no-store' 
    });
    
    if (!res.ok) {
      if (attempt < MAX_RETRIES - 1) {
        await new Promise(r => setTimeout(r, RETRY_BACKOFF[attempt]));
        return fetchLive(attempt + 1);
      }
      throw new Error(`price feed ${res.status} after ${MAX_RETRIES} attempts`);
    }
    
    const json = await res.json();
    const next = { ...DEFAULT_PRICES };
    let live = 0;
    
    for (const [id, cg] of Object.entries(IDS)) {
      const v = json?.[cg]?.usd;
      if (typeof v === 'number' && v > 0) {
        next[id] = v;
        live += 1;
      }
    }
    
    if (!live) {
      if (attempt < MAX_RETRIES - 1) {
        await new Promise(r => setTimeout(r, RETRY_BACKOFF[attempt]));
        return fetchLive(attempt + 1);
      }
      throw new Error('empty price feed after retries');
    }
    
    return next;
  } catch (error) {
    if (attempt < MAX_RETRIES - 1) {
      await new Promise(r => setTimeout(r, RETRY_BACKOFF[attempt]));
      return fetchLive(attempt + 1);
    }
    throw error;
  }
}

// BTC 24h change and the last 24 hourly prices, for the sparkline. Refreshed in the background every 5 minutes.
async function fetchTrend() {
  const url = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin&sparkline=true&price_change_percentage=24h';
  const res = await fetch(url, { signal: AbortSignal.timeout(3000), cache: 'no-store' });
  if (!res.ok) throw new Error(`trend feed ${res.status}`);
  const [c] = await res.json();
  const hourly = c?.sparkline_in_7d?.price;
  const change = c?.price_change_percentage_24h_in_currency ?? c?.price_change_percentage_24h;
  if (!Array.isArray(hourly) || hourly.length < 24 || typeof change !== 'number') throw new Error('empty trend feed');
  return { change: Math.round(change * 100) / 100, spark: hourly.slice(-24).map((v) => Math.round(v)) };
}

function refreshTrend() {
  if (process.env.PRICE_FEED === 'static' || state.trendInflight || Date.now() - (state.trendAt || 0) < TREND_EVERY) return;
  state.trendInflight = fetchTrend()
    .then((t) => {
      state.trend = t;
      state.trendAt = Date.now();
    })
    .catch(() => {
      state.trendAt = Date.now() - TREND_EVERY + 60_000; // try again in a minute
    })
    .finally(() => {
      state.trendInflight = null;
    });
}

async function refresh() {
  if (process.env.PRICE_FEED === 'static') {
    state.at = Date.now();
    return;
  }
  try {
    state.prices = await fetchLive();
    state.source = 'live';
    state.at = Date.now();
  } catch {
    state.at = Date.now() - FRESH + RETRY;
  }
}

export async function getPrices() {
  const age = Date.now() - state.at;
  if (age >= FRESH && !state.inflight) {
    state.inflight = refresh().finally(() => {
      state.inflight = null;
    });
  }
  if (!state.at || age >= STALE) await state.inflight;
  refreshTrend();
  return { prices: state.prices, at: state.at, source: state.source, trend: state.trend ?? null };
}
