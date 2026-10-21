// The market Smart Mining follows: one row per coin and UTC day, and the coin picked for each finished day.
//
//   live       BTC comes from the same live market as the fixed plans (lib/server/market.js). KAS, RVN and XMR take their
//              price from CoinGecko and their network figures (reward, block time, network hashrate) from WhatToMine.
//              A coin missing any figure has no gross that day and is simply not eligible.
//   coin_days  today's rows follow the live market and are rewritten every few minutes; when the day is over nothing writes
//              to them again. The first reading of a coin also becomes its reference (smart_coins.ref_gross).
//   picks      smart_picks has one row per finished day, written once from that day's coin_days and then locked.
// Set PRICE_FEED=static to turn all of this off.
import { q } from '@/lib/server/db';
import { grossPerUnit, ratioOf, pickCoin } from '@/lib/smart';

const DAY = 86400000;
const SNAP_EVERY = 300_000;
const NET_FRESH = 600_000; // network figures move slowly
const PRICE_FRESH = 60_000;
const PRICE_MAX_AGE = 600_000; // a price older than this is not used
const RETRY = 60_000;
const MAX_CATCH_UP = 400;
const CG = { KAS: 'kaspa', RVN: 'ravencoin', XMR: 'monero' };

const state = (globalThis.__opusSmart ||= {});
const utcDay = (t) => Math.floor(t / DAY) * DAY;

// One feed, cached: one refresh at a time, the last good value kept, and dropped once older than maxAge.
async function feed(name, fresh, maxAge, fetcher) {
  const s = (state[name] ||= { value: null, at: 0, okAt: 0, inflight: null });
  if (Date.now() - s.at >= fresh && !s.inflight) {
    s.inflight = fetcher()
      .then((v) => {
        s.value = v;
        s.at = s.okAt = Date.now();
      })
      .catch(() => {
        s.at = Date.now() - fresh + RETRY;
      })
      .finally(() => {
        s.inflight = null;
      });
  }
  if (s.value === null && s.inflight) await s.inflight;
  return s.value !== null && Date.now() - s.okAt < maxAge ? s.value : null;
}

// { KAS: { nethash, reward, blockTime }, ... } from the WhatToMine lists. coins.json holds the GPU coins (RVN); asic.json holds
// the ASIC and CPU coins (KAS, XMR). nethash is in H/s in both. One list failing is fine as long as the other answers.
const NET_URLS = ['https://whattomine.com/coins.json', 'https://whattomine.com/asic.json'];
async function fetchNetworks() {
  const lists = await Promise.allSettled(
    NET_URLS.map(async (url) => {
      const res = await fetch(url, { signal: AbortSignal.timeout(6000), cache: 'no-store' });
      if (!res.ok) throw new Error(`network feed ${res.status}`);
      return res.json();
    }),
  );
  const out = {};
  for (const l of lists) {
    if (l.status !== 'fulfilled') continue;
    for (const c of Object.values(l.value?.coins || {})) {
      const tag = String(c?.tag || '').toUpperCase();
      const nethash = Number(c?.nethash);
      const reward = Number(c?.block_reward);
      const blockTime = Number(c?.block_time);
      if (tag && !out[tag] && nethash > 0 && reward > 0 && blockTime > 0) out[tag] = { nethash, reward, blockTime };
    }
  }
  if (!Object.keys(out).length) throw new Error('empty network feed');
  return out;
}

// { KAS: usd, RVN: usd, XMR: usd } from CoinGecko.
async function fetchCoinPrices() {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${Object.values(CG).join(',')}&vs_currencies=usd`;
  const res = await fetch(url, { signal: AbortSignal.timeout(3000), cache: 'no-store' });
  if (!res.ok) throw new Error(`coin price feed ${res.status}`);
  const json = await res.json();
  const out = {};
  for (const [symbol, id] of Object.entries(CG)) {
    const v = json?.[id]?.usd;
    if (typeof v === 'number' && v > 0) out[symbol] = v;
  }
  if (!Object.keys(out).length) throw new Error('empty coin price feed');
  return out;
}

// The coins Smart Mining may pick from, kept for a few seconds.
async function enabledCoins() {
  if (state.coins && Date.now() - state.coinsAt < 15_000) return state.coins;
  state.coins = (await q('SELECT symbol, unit FROM smart_coins WHERE enabled ORDER BY sort')).rows;
  state.coinsAt = Date.now();
  return state.coins;
}

// { SYMBOL: { gross, price, nethash, reward, blockTime } } for every enabled coin that has a trustworthy figure now,
// or null when none has (feed off or down).
export async function getCoinLive() {
  if (process.env.PRICE_FEED === 'static') return null;
  const { getLive } = await import('@/lib/server/market'); // loaded here because market.js imports this file
  const coins = await enabledCoins();
  const [btc, nets, prices] = await Promise.all([
    getLive().catch(() => null),
    feed('nets', NET_FRESH, 86400000, fetchNetworks).catch(() => null),
    feed('prices', PRICE_FRESH, PRICE_MAX_AGE, fetchCoinPrices).catch(() => null),
  ]);
  const out = {};
  for (const { symbol, unit } of coins) {
    if (symbol === 'BTC') {
      if (btc?.gross > 0) out.BTC = { gross: btc.gross, price: btc.btc };
      continue;
    }
    const n = nets?.[symbol];
    const price = prices?.[symbol];
    const gross = n && price ? grossPerUnit({ price, nethash: n.nethash, reward: n.reward, blockTime: n.blockTime, unit }) : null;
    if (gross) out[symbol] = { gross, price, ...n };
  }
  return Object.keys(out).length ? out : null;
}

// Saves the live market as today's rows. Only today's rows are written, and only while the day is open.
export async function recordCoins(now = Date.now()) {
  const live = await getCoinLive();
  if (!live) return false;
  const day = utcDay(now);
  for (const [coin, v] of Object.entries(live)) {
    await q(
      `INSERT INTO coin_days (day, coin, price_usd, nethash, block_reward, block_time_s, gross_per_unit, at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (day, coin) DO UPDATE SET price_usd = EXCLUDED.price_usd, nethash = EXCLUDED.nethash,
         block_reward = EXCLUDED.block_reward, block_time_s = EXCLUDED.block_time_s,
         gross_per_unit = EXCLUDED.gross_per_unit, at = EXCLUDED.at
       WHERE coin_days.at < EXCLUDED.at AND EXCLUDED.at < coin_days.day + $9`,
      [day, coin, v.price.toFixed(10), v.nethash ? String(Math.round(v.nethash)) : null, v.reward ?? null, v.blockTime ?? null, v.gross.toFixed(12), now, DAY],
    );
    await q('UPDATE smart_coins SET ref_gross = $2 WHERE symbol = $1 AND ref_gross IS NULL', [coin, v.gross.toFixed(12)]);
  }
  state.lastRecord = now;
  return true;
}

// Writes the pick of every finished day that has none yet, oldest first, each from that day's own rows and the day before's
// pick. A day with no usable coin keeps the previous coin (BTC when there is none). Written once, then locked.
export async function ensurePicks(now = Date.now()) {
  const today = utcDay(now);
  const last = (await q('SELECT day, coin FROM smart_picks ORDER BY day DESC LIMIT 1')).rows[0];
  const first = (await q('SELECT min(day) AS d FROM coin_days')).rows[0]?.d;
  let day = last ? Number(last.day) + DAY : first !== null && first !== undefined ? Number(first) : today;
  if (day >= today) return 0;
  const refs = {};
  for (const r of (await q('SELECT symbol, ref_gross FROM smart_coins')).rows) refs[r.symbol] = Number(r.ref_gross);
  let prev = last?.coin ?? null;
  let n = 0;
  for (; day < today && n < MAX_CATCH_UP; day += DAY, n += 1) {
    const ratios = {};
    for (const r of (await q('SELECT coin, gross_per_unit FROM coin_days WHERE day = $1', [day])).rows) {
      ratios[r.coin] = ratioOf(Number(r.gross_per_unit), refs[r.coin]);
    }
    const coin = pickCoin(ratios, prev) || prev || 'BTC';
    await q('INSERT INTO smart_picks (day, coin, at) VALUES ($1, $2, $3) ON CONFLICT (day) DO NOTHING', [day, coin, now]);
    prev = coin;
  }
  return n;
}

// What lib/earnings.js needs for Smart Mining: { picks, days, refs, units, live, prev } (shapes in smartRatio there). The saved part is
// kept for a few seconds so busy pages do not repeat the queries. Never throws: null means no Smart Mining data, and the
// earnings code then pays at the reference.
const SMART_TTL = 15_000;
const SMART_DAYS = 400;
async function loadSaved(c) {
  if (state.saved && Date.now() - state.savedAt < SMART_TTL) return state.saved;
  const since = utcDay(Date.now()) - SMART_DAYS * DAY;
  const [pk, cd, rf] = await Promise.all([
    q('SELECT day, coin FROM smart_picks WHERE day >= $1', [since], c),
    q('SELECT day, coin, gross_per_unit FROM coin_days WHERE day >= $1', [since], c),
    q('SELECT symbol, ref_gross, unit FROM smart_coins', undefined, c),
  ]);
  const picks = {};
  let prevDay = -1;
  let prev = null;
  for (const r of pk.rows) {
    picks[Number(r.day)] = r.coin;
    if (Number(r.day) > prevDay) {
      prevDay = Number(r.day);
      prev = r.coin;
    }
  }
  const days = {};
  for (const r of cd.rows) (days[Number(r.day)] ||= {})[r.coin] = Number(r.gross_per_unit);
  const refs = {};
  const units = {};
  for (const r of rf.rows) {
    units[r.symbol] = r.unit;
    if (r.ref_gross !== null) refs[r.symbol] = Number(r.ref_gross);
  }
  state.saved = { picks, days, refs, units, prev };
  state.savedAt = Date.now();
  return state.saved;
}

export async function getSmart(c) {
  try {
    const saved = await loadSaved(c);
    let live = null;
    try {
      const l = await getCoinLive();
      if (l) live = Object.fromEntries(Object.entries(l).map(([coin, v]) => [coin, v.gross]));
    } catch (e) {
      console.error('[smart] live market unavailable:', e.message);
    }
    return { ...saved, live };
  } catch (e) {
    console.error('[smart] could not read Smart Mining data:', e.message);
    return null;
  }
}

// Called once at boot: records now and every five minutes after, and fills in the picks of finished days.
export function startSmartTicker() {
  if (globalThis.__opusSmartTimer) return;
  const run = async () => {
    try {
      await recordCoins();
      await ensurePicks();
    } catch (e) {
      console.error('[smart] snapshot failed:', e.message);
    }
  };
  run();
  globalThis.__opusSmartTimer = setInterval(run, SNAP_EVERY);
  globalThis.__opusSmartTimer.unref?.();
}
