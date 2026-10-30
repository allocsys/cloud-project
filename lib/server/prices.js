// Server-side price cache. One refresh at a time, shared by every request.
//   fresh (< 30 s): served straight from memory
//   stale (< 5 min): served from memory while one background refresh runs
//   older, or never fetched: wait for the refresh
// Last known prices: every good reading is kept per coin (a coin missing from a reading keeps its last value, it never drops back to
// the static price) and saved to the database (meta "prices") every few minutes, so a restart while the feed is down still has them.
// The static prices in lib/assets.js are for display only. Code that moves money asks pricesFor(): it refuses when a coin has never had
// a real price. Set PRICE_FEED=static to turn the live feed off (staging and tests): the static prices are then allowed everywhere.
import { DEFAULT_PRICES } from '@/lib/assets';
import { warm, metaGet, metaSet } from '@/lib/server/db';

const IDS = { btc: 'bitcoin', eth: 'ethereum', bnb: 'binancecoin', trx: 'tron', usdt: 'tether', ton: 'the-open-network' };
const STABLE = new Set(['usdt']); // pegged: the static 1 is always safe
const FRESH = 30_000;
const STALE = 300_000;
const RETRY = 5_000;
const TREND_EVERY = 300_000;
const SAVE_EVERY = 300_000;

export const NO_PRICE = 'Prices are unavailable right now. Try again in a moment.';

// source: 'live' (a real reading this run), 'saved' (last known, restored from the database, no reading yet this run), 'static' (nothing known).
// seen[coin]: when that coin last had a real reading (0 or missing = never).
const state = (globalThis.__vtxPrices ||= { prices: { ...DEFAULT_PRICES }, at: 0, source: 'static', inflight: null });
state.seen ||= {};
state.savedAt ||= 0;

const staticMode = () => process.env.PRICE_FEED === 'static';

async function fetchLive() {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${Object.values(IDS).join(',')}&vs_currencies=usd`;
  const res = await fetch(url, { signal: AbortSignal.timeout(3000), cache: 'no-store' });
  if (!res.ok) throw new Error(`price feed ${res.status}`);
  const json = await res.json();
  const got = {};
  for (const [id, cg] of Object.entries(IDS)) {
    const v = json?.[cg]?.usd;
    if (typeof v === 'number' && v > 0) got[id] = v;
  }
  if (!Object.keys(got).length) throw new Error('empty price feed');
  return got;
}

// The prices saved by an earlier run, used until a real reading arrives. Never throws.
async function loadSaved() {
  if (staticMode()) return;
  try {
    await warm();
    const s = metaGet('prices');
    for (const id of Object.keys(IDS)) {
      const v = Number(s?.prices?.[id]);
      if (v > 0 && !state.seen[id]) {
        state.prices = { ...state.prices, [id]: v };
        state.seen[id] = Number(s?.at?.[id]) || 1;
      }
    }
    if (state.source === 'static' && state.seen.btc) state.source = 'saved';
  } catch {}
}

// Saves what is known, at most every SAVE_EVERY. Never throws.
async function saveKnown() {
  if (Date.now() - state.savedAt < SAVE_EVERY) return;
  const prices = {};
  const at = {};
  for (const id of Object.keys(IDS)) {
    if (state.seen[id]) {
      prices[id] = state.prices[id];
      at[id] = state.seen[id];
    }
  }
  try {
    await metaSet('prices', { prices, at });
    state.savedAt = Date.now();
  } catch {}
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
  if (staticMode() || state.trendInflight || Date.now() - (state.trendAt || 0) < TREND_EVERY) return;
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
  if (staticMode()) {
    state.at = Date.now();
    return;
  }
  try {
    const got = await fetchLive();
    const now = Date.now();
    state.prices = { ...state.prices, ...got }; // a coin missing from this reading keeps its last known price
    for (const id of Object.keys(got)) state.seen[id] = now;
    if (got.btc) state.source = 'live';
    state.at = now;
    await saveKnown();
  } catch {
    state.at = Date.now() - FRESH + RETRY;
  }
}

export async function getPrices() {
  if (!staticMode()) {
    state.loadP ||= loadSaved();
    await state.loadP;
  }
  const age = Date.now() - state.at;
  if (age >= FRESH && !state.inflight) {
    state.inflight = refresh().finally(() => {
      state.inflight = null;
    });
  }
  if (!state.at || age >= STALE) await state.inflight;
  refreshTrend();
  const have = {};
  for (const id of Object.keys(IDS)) have[id] = !!state.seen[id] || STABLE.has(id);
  return { prices: state.prices, at: state.at, source: state.source, trend: state.trend ?? null, have };
}

// The prices for money code: { ok: true, prices } when every coin in `ids` has a real (live or last known) price, or the feed is switched
// to static on purpose; { ok: false } otherwise. A caller that gets ok: false must refuse (NO_PRICE), never fall back to a static price.
export async function pricesFor(ids = ['btc']) {
  const p = await getPrices();
  if (staticMode() || ids.every((id) => p.have[id])) return { ok: true, prices: p.prices, source: p.source };
  return { ok: false };
}
