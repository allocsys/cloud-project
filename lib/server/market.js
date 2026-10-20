// The market the daily payouts follow: live BTC price and network difficulty, and one saved snapshot per UTC day.
//
//   live       BTC price (lib/server/prices.js) and difficulty (below) now, and the gross hashprice they give.
//   snapshot   market_days has one row per UTC day. Today's row follows the live market and is rewritten every few
//              minutes; when the day is over nothing writes to it again, so a paid day is locked. A day nobody
//              recorded (server down all day) has no row, and the earnings code uses the static fallback for it.
// Set PRICE_FEED=static to turn all of this off: there is no live market, and miners pay their static dailyUsd.
import { getPrices } from '@/lib/server/prices';
import { q, warm, catalog } from '@/lib/server/db';
import { grossPerThDay, validDifficulty } from '@/lib/market';

const DAY = 86400000;
const DIFF_FRESH = 600_000; // difficulty changes every two weeks or so, ten minutes is plenty
const RETRY = 60_000;
const SNAP_EVERY = 300_000;
const DAYS_TTL = 15_000;

const state = (globalThis.__opusMarket ||= { difficulty: null, diffAt: 0, diffInflight: null, days: null, daysAt: 0, lastRecord: 0 });
const utcDay = (t) => Math.floor(t / DAY) * DAY;

// Network difficulty from mempool.space, or blockchain.info when that is down.
async function fetchDifficulty() {
  try {
    const res = await fetch('https://mempool.space/api/v1/mining/hashrate/3d', { signal: AbortSignal.timeout(4000), cache: 'no-store' });
    if (res.ok) {
      const d = Number((await res.json())?.currentDifficulty);
      if (validDifficulty(d)) return d;
    }
  } catch {}
  const res = await fetch('https://blockchain.info/q/getdifficulty', { signal: AbortSignal.timeout(4000), cache: 'no-store' });
  if (!res.ok) throw new Error(`difficulty feed ${res.status}`);
  const d = Number(await res.text());
  if (!validDifficulty(d)) throw new Error('bad difficulty');
  return d;
}

// The last good difficulty. It moves slowly, so an old reading is still right; null only if none was ever read.
async function getDifficulty() {
  if (Date.now() - state.diffAt >= DIFF_FRESH && !state.diffInflight) {
    state.diffInflight = fetchDifficulty()
      .then((d) => {
        state.difficulty = d;
        state.diffAt = Date.now();
      })
      .catch(() => {
        state.diffAt = Date.now() - DIFF_FRESH + RETRY;
      })
      .finally(() => {
        state.diffInflight = null;
      });
  }
  if (state.difficulty === null) await state.diffInflight;
  return state.difficulty;
}

// { btc, difficulty, gross, at }, or null when there is no trustworthy live market (feed off, down, or on static prices).
export async function getLive() {
  if (process.env.PRICE_FEED === 'static') return null;
  const [p, difficulty] = await Promise.all([getPrices(), getDifficulty()]);
  if (p.source !== 'live' || !validDifficulty(difficulty) || !(p.prices?.btc > 0)) return null;
  return { btc: p.prices.btc, difficulty, gross: grossPerThDay(difficulty, p.prices.btc), at: Date.now() };
}

// Saves the live market as today's snapshot. Only today's row is ever written, and only while that day is still open.
export async function recordMarket(now = Date.now()) {
  const live = await getLive();
  if (!live) return false;
  const day = utcDay(now);
  await q(
    `INSERT INTO market_days (day, btc_usd, difficulty, gross_per_th, at) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (day) DO UPDATE SET btc_usd = EXCLUDED.btc_usd, difficulty = EXCLUDED.difficulty,
       gross_per_th = EXCLUDED.gross_per_th, at = EXCLUDED.at
     WHERE market_days.at < EXCLUDED.at AND EXCLUDED.at < market_days.day + $6`,
    [day, live.btc.toFixed(2), String(Math.round(live.difficulty)), live.gross.toFixed(8), now, DAY],
  );
  state.lastRecord = now;
  return true;
}

// Every saved day as { [utcMidnightMs]: { gross, btc } }. Kept for a few seconds so busy pages do not repeat the query.
async function loadDays() {
  if (state.days && Date.now() - state.daysAt < DAYS_TTL) return state.days;
  const r = await q('SELECT day, btc_usd, gross_per_th FROM market_days');
  const days = {};
  for (const row of r.rows) days[Number(row.day)] = { gross: Number(row.gross_per_th), btc: Number(row.btc_usd) };
  state.days = days;
  state.daysAt = Date.now();
  return days;
}

// What lib/earnings.js needs: { days, live, halls }. Never throws: with no market data the earnings code falls back
// to each miner's static dailyUsd.
export async function getMarket() {
  let days = {};
  let live = null;
  try {
    await warm();
  } catch {}
  try {
    days = await loadDays();
  } catch (e) {
    console.error('[market] could not read market_days:', e.message);
  }
  try {
    live = await getLive();
  } catch (e) {
    console.error('[market] live market unavailable:', e.message);
  }
  // Keeps today's snapshot fresh even when the background timer is not running (for example in tests or a quiet server).
  if (live && Date.now() - state.lastRecord >= SNAP_EVERY) {
    state.lastRecord = Date.now();
    recordMarket().catch((e) => console.error('[market] snapshot failed:', e.message));
  }
  return { days, live, halls: catalog().halls };
}

// Called once at boot: records a snapshot now and every five minutes after.
export function startMarketTicker() {
  if (globalThis.__opusMarketTimer) return;
  const run = () => recordMarket().catch((e) => console.error('[market] snapshot failed:', e.message));
  run();
  globalThis.__opusMarketTimer = setInterval(run, SNAP_EVERY);
  globalThis.__opusMarketTimer.unref?.();
}
