// The market Smart Mining follows: one row per coin and UTC day, and the coin picked for each finished day.
//
//   live       BTC comes from the same live market as the fixed plans (lib/server/market.js). KAS, RVN and XMR take their
//              price from CoinGecko and their network figures (reward, block time, network hashrate) from WhatToMine.
//              A coin missing any figure has no gross that day and is simply not eligible.
//   coin_days  today's rows follow the live market and are rewritten every few minutes; when the day is over nothing writes
//              to them again. Each row keeps the gross per unit and the NET profit per reference rig (net_per_rig: gross x the rig's
//              hashrate minus its electricity, USD a day, the same scale for every coin). Coins are compared by net profit and
//              measured against ONE anchor (smart_coins.ref_net, the same on every row, set by the first positive reading).
//   picks      smart_picks has one row per finished day, written once from that day's coin_days and then locked.
// Set PRICE_FEED=static to turn all of this off.
import { q, metaGet } from '@/lib/server/db';
import { grossPerUnit, netPerRig, ratioOf, pickCoin } from '@/lib/smart';
import { mergeSmartHalls } from '@/lib/smart-halls';

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

// The price of a kWh, from two public sources and no key: Eurostat's industrial electricity price (consumers of 20,000 to 69,999 MWh
// a year, without VAT and recoverable taxes; the latest half-year, average of Iceland and Norway, the countries of the Smart halls)
// and the ECB euro rate from Frankfurter. Eurostat publishes twice a year, so the price moves in steps. Used for every coin when the
// switch is on (meta smart.kwhAuto, default on); when the feed is down or older than 30 days each coin's own kwh_usd is used.
const KWH_URL = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/nrg_pc_205?format=JSON&lang=en&geo=NO&geo=IS&nrg_cons=MWH20000-69999&tax=X_VAT&currency=EUR&unit=KWH&lastTimePeriod=1';
const FX_URL = 'https://api.frankfurter.dev/v1/latest?base=EUR&symbols=USD';
const KWH_FRESH = 12 * 3600_000;
const KWH_MAX_AGE = 30 * 86400_000;
async function fetchKwh() {
  const [e, f] = await Promise.all([
    fetch(KWH_URL, { signal: AbortSignal.timeout(8000), cache: 'no-store' }),
    fetch(FX_URL, { signal: AbortSignal.timeout(5000), cache: 'no-store' }),
  ]);
  if (!e.ok || !f.ok) throw new Error(`electricity feed ${e.status}/${f.status}`);
  const [ej, fj] = await Promise.all([e.json(), f.json()]);
  const eur = Object.values(ej?.value || {}).map(Number).filter((v) => v > 0);
  const rate = Number(fj?.rates?.USD);
  if (!eur.length || !(rate > 0)) throw new Error('empty electricity feed');
  const avg = eur.reduce((a, b) => a + b, 0) / eur.length;
  const kwh = Math.round(avg * rate * 1e4) / 1e4;
  if (!(kwh >= 0.01 && kwh <= 1)) throw new Error('electricity price out of range');
  return { kwh, eur: Math.round(avg * 1e4) / 1e4, rate, rateDate: fj?.date || '', period: Object.keys(ej?.dimension?.time?.category?.index || {})[0] || '' };
}

// What the admin screen shows: whether the live price is on, the last good reading and the price in use (null = each coin's own).
export async function smartCost() {
  const auto = metaGet('smart')?.kwhAuto !== false;
  const live = process.env.PRICE_FEED === 'static' ? null : await feed('kwh', KWH_FRESH, KWH_MAX_AGE, fetchKwh).catch(() => null);
  return { auto, live, inUse: auto && live ? live.kwh : null };
}

// The coins Smart Mining may pick from, kept for a few seconds.
// A request that comes while the read is running waits for it instead of starting its own.
async function enabledCoins() {
  if (state.coins && Date.now() - state.coinsAt < 15_000) return state.coins;
  if (!state.coinsInflight) {
    state.coinsInflight = q('SELECT symbol, unit, rig_hash, rig_watts, kwh_usd FROM smart_coins WHERE enabled ORDER BY sort')
      .then((r) => {
        state.coins = r.rows;
        state.coinsAt = Date.now();
        return state.coins;
      })
      .finally(() => {
        state.coinsInflight = null;
      });
  }
  return state.coinsInflight;
}

// { SYMBOL: { gross, net, price, nethash, reward, blockTime } } for every enabled coin that has a trustworthy figure now
// (net = USD a day a reference rig earns after electricity, null when the coin has no rig figures),
// or null when none has (feed off or down).
export async function getCoinLive() {
  if (process.env.PRICE_FEED === 'static') return null;
  const { getLive } = await import('@/lib/server/market'); // loaded here because market.js imports this file
  const coins = await enabledCoins();
  const [btc, nets, prices, cost] = await Promise.all([
    getLive().catch(() => null),
    feed('nets', NET_FRESH, 86400000, fetchNetworks).catch(() => null),
    feed('prices', PRICE_FRESH, PRICE_MAX_AGE, fetchCoinPrices).catch(() => null),
    smartCost().catch(() => null),
  ]);
  const out = {};
  const netOf = (c, gross) => netPerRig({ gross, rigHash: Number(c.rig_hash), watts: Number(c.rig_watts), kwh: cost?.inUse ?? Number(c.kwh_usd) });
  for (const c of coins) {
    const { symbol, unit } = c;
    if (symbol === 'BTC') {
      if (btc?.gross > 0) out.BTC = { gross: btc.gross, net: netOf(c, btc.gross), price: btc.btc };
      continue;
    }
    const n = nets?.[symbol];
    const price = prices?.[symbol];
    const gross = n && price ? grossPerUnit({ price, nethash: n.nethash, reward: n.reward, blockTime: n.blockTime, unit }) : null;
    if (gross) out[symbol] = { gross, net: netOf(c, gross), price, ...n };
  }
  return Object.keys(out).length ? out : null;
}

// Saves the live market as today's rows. Only today's rows are written, and only while the day is open.
export async function recordCoins(now = Date.now()) {
  const live = await getCoinLive();
  if (!live) return false;
  const day = utcDay(now);
  // All coins in one statement, in symbol order, so two servers writing at the same time cannot deadlock.
  const rows = Object.entries(live).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  await q(
    `INSERT INTO coin_days (day, coin, price_usd, nethash, block_reward, block_time_s, gross_per_unit, net_per_rig, at)
     SELECT $1::bigint, t.coin, t.price, t.nethash, t.reward, t.block_time, t.gross, t.net, $2::bigint
       FROM unnest($3::text[], $4::numeric[], $5::numeric[], $6::numeric[], $7::numeric[], $8::numeric[], $9::numeric[]) AS t(coin, price, nethash, reward, block_time, gross, net)
      ORDER BY t.coin
     ON CONFLICT (day, coin) DO UPDATE SET price_usd = EXCLUDED.price_usd, nethash = EXCLUDED.nethash,
       block_reward = EXCLUDED.block_reward, block_time_s = EXCLUDED.block_time_s,
       gross_per_unit = EXCLUDED.gross_per_unit, net_per_rig = EXCLUDED.net_per_rig, at = EXCLUDED.at
     WHERE coin_days.at < EXCLUDED.at AND EXCLUDED.at < coin_days.day + $10::bigint`,
    [
      day,
      now,
      rows.map(([coin]) => coin),
      rows.map(([, v]) => v.price.toFixed(10)),
      rows.map(([, v]) => (v.nethash ? String(Math.round(v.nethash)) : null)),
      rows.map(([, v]) => v.reward ?? null),
      rows.map(([, v]) => v.blockTime ?? null),
      rows.map(([, v]) => v.gross.toFixed(12)),
      rows.map(([, v]) => (Number.isFinite(v.net) ? v.net.toFixed(12) : null)),
      DAY,
    ],
  );
  // The one anchor every coin is measured against: the best positive net profit of the first reading. Set once for all coins
  // (a coin added later takes the same value) and never reset, so finished days keep their meaning.
  const best = Math.max(0, ...Object.values(live).map((v) => v.net).filter(Number.isFinite));
  if (best > 0) await q('UPDATE smart_coins SET ref_net = COALESCE((SELECT max(ref_net) FROM smart_coins), $1::numeric) WHERE ref_net IS NULL', [best.toFixed(12)]);
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
  for (const r of (await q('SELECT symbol, ref_net FROM smart_coins')).rows) refs[r.symbol] = Number(r.ref_net);
  let prev = last?.coin ?? null;
  let n = 0;
  for (; day < today && n < MAX_CATCH_UP; day += DAY, n += 1) {
    const ratios = {};
    for (const r of (await q('SELECT coin, net_per_rig FROM coin_days WHERE day = $1', [day])).rows) {
      ratios[r.coin] = r.net_per_rig === null ? null : ratioOf(Number(r.net_per_rig), refs[r.coin]);
    }
    const coin = pickCoin(ratios, prev) || prev || 'BTC';
    const ins = await q('INSERT INTO smart_picks (day, coin, at) VALUES ($1, $2, $3) ON CONFLICT (day) DO NOTHING RETURNING coin', [day, coin, now]);
    // Another server may have written this day first: its pick is the one that stands, so the next day continues from it.
    prev = ins.rows[0] ? ins.rows[0].coin : (await q('SELECT coin FROM smart_picks WHERE day = $1', [day])).rows[0]?.coin ?? coin;
  }
  return n;
}

// What lib/earnings.js needs for Smart Mining: { picks, days, refs, units, live, prev, halls } (shapes in smartRatio there; halls are the
// Smart halls with the admin's saved details, read from the meta cache each time so an edit shows within seconds). The saved part is
// kept for a few seconds so busy pages do not repeat the queries. Never throws: null means no Smart Mining data, and the
// earnings code then pays at the reference.
const SMART_TTL = 15_000;
const SMART_DAYS = 400;
// A request that comes while the read is running waits for it instead of starting its own.
async function loadSaved(c) {
  if (state.saved && Date.now() - state.savedAt < SMART_TTL) return state.saved;
  if (!state.savedInflight) {
    state.savedInflight = readSaved(c).finally(() => {
      state.savedInflight = null;
    });
  }
  return state.savedInflight;
}

async function readSaved(c) {
  const since = utcDay(Date.now()) - SMART_DAYS * DAY;
  const [pk, cd, rf] = await Promise.all([
    q('SELECT day, coin FROM smart_picks WHERE day >= $1', [since], c),
    q('SELECT day, coin, net_per_rig FROM coin_days WHERE day >= $1 AND net_per_rig IS NOT NULL', [since], c),
    q('SELECT symbol, ref_net, unit FROM smart_coins', undefined, c),
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
  for (const r of cd.rows) (days[Number(r.day)] ||= {})[r.coin] = Number(r.net_per_rig);
  const refs = {};
  const units = {};
  for (const r of rf.rows) {
    units[r.symbol] = r.unit;
    if (r.ref_net !== null) refs[r.symbol] = Number(r.ref_net);
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
      if (l) live = Object.fromEntries(Object.entries(l).filter(([, v]) => Number.isFinite(v.net)).map(([coin, v]) => [coin, v.net]));
    } catch (e) {
      console.error('[smart] live market unavailable:', e.message);
    }
    return { ...saved, live, halls: mergeSmartHalls(metaGet('smarthalls')) };
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
