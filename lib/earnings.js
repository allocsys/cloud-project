// Numbers for the Earnings page, worked out from the user's own miners.
// Pure (no storage), so it runs on the server and could run in the browser too.
// Payout days run 00:00 to 24:00 UTC, the same as the payout countdown.
//
// What a day pays comes from the market of that day (see lib/market.js): net per TH/s = gross hashprice minus the hall's
// electricity and maintenance, never below zero. `market` is { days: { [utcMidnightMs]: { gross, btc } }, live, halls }:
//   days   the saved snapshot of every finished day (lib/server/market.js). A finished day never changes.
//   live   the current market, used for today only
//   halls  the catalogue's halls, for their electricity and maintenance
// A day with no market data falls back to the last saved snapshot before it (up to CARRY_DAYS back), and only then to the
// miner's own static dailyUsd and the static BTC price.
import { BTC_USD } from '@/lib/data';
import { netPerThDay } from '@/lib/market';
import { realHash, uptimeOf } from '@/lib/telemetry';
import { ratioOf, pickCoin, dailyUsd as smartUsd, smartSeries, smartSettle } from '@/lib/smart';

const DAY = 86400000;
const CARRY_DAYS = 14;
const HOUR = 3600000;
const utcDay = (t) => Math.floor(t / DAY) * DAY;
const dayText = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const weekdayText = (t) => new Date(t).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;

// When a miner went live. Miners bought in the app carry startedAt; the sample ones only have a date like "2 Oct".
export function startOf(c, now) {
  if (Number.isFinite(c.startedAt)) return c.startedAt;
  const y = new Date(now).getUTCFullYear();
  let t = Date.parse(`${c.started} ${y} 00:00 UTC`);
  if (Number.isFinite(t) && t > now) t = Date.parse(`${c.started} ${y - 1} 00:00 UTC`);
  return Number.isFinite(t) ? t : utcDay(now) - (c.elapsed || 0) * DAY;
}

// When a miner stops earning: its term ends, or it went offline (offline counts from the start of today).
export function stopOf(c, start, now) {
  const end = start + c.days * DAY;
  return c.online === false ? Math.min(end, utcDay(now)) : Math.min(end, now);
}

// The market a day is paid from: today follows the live feed, a finished day uses its saved snapshot. A day with neither
// (the server was down, the feeds failed) carries forward the nearest earlier snapshot, up to CARRY_DAYS back. A saved day
// never changes once it is over, so a carried day never changes either. Null means none, and the caller uses the static rates.
function dayMarket(market, day, today) {
  if (!market) return null;
  const own = day === today ? market.live || market.days?.[day] : market.days?.[day];
  if (own) return own;
  if (!market.days) return null;
  for (let k = 1; k <= CARRY_DAYS; k += 1) if (market.days[day - k * DAY]) return market.days[day - k * DAY];
  return null;
}

// BTC price a day is converted at.
const btcOn = (market, day, today, fallback) => dayMarket(market, day, today)?.btc || fallback;

// How a day's picked coin compares with its reference (lib/smart.js), 1 = as priced. `sm` is market.smart:
//   picks  { [utcMidnightMs]: coin }, the locked pick of every finished day
//   days   { [utcMidnightMs]: { [coin]: gross } }, the saved market of every finished day
//   refs   { [coin]: gross }, what each coin is measured against
//   live   { [coin]: gross } now, used for today only (null when the feeds are down)
//   prev   the coin of the latest finished day, which today's pick holds inside the hysteresis
// A day with no usable figure carries forward the nearest earlier day's ratio (up to CARRY_DAYS), and only then pays at 1.
function smartRatio(sm, day, today) {
  if (!sm) return 1;
  if (day === today && sm.live) {
    const ratios = {};
    for (const [coin, g] of Object.entries(sm.live)) ratios[coin] = ratioOf(g, sm.refs?.[coin]);
    const coin = pickCoin(ratios, sm.prev ?? null);
    if (coin) return ratios[coin];
  }
  for (let k = day === today ? 1 : 0; k <= CARRY_DAYS; k += 1) {
    const d = day - k * DAY;
    const coin = sm.picks?.[d];
    const r = coin ? ratioOf(sm.days?.[d]?.[coin], sm.refs?.[coin]) : null;
    if (r) return r;
  }
  return 1;
}

// What one miner pays for a whole day at market `mk`: th x net rate, or its static dailyUsd when there is no market
// or its hall does not state its rates. A Smart Mining contract (c.smart) pays budget x base yield x the day's coin ratio.
function perDay(c, mk, market, day, today) {
  if (c.smart) return smartUsd(c.budget, c.baseYield, smartRatio(market?.smart, day, today));
  const net = mk ? netPerThDay(mk.gross, market.halls?.[c.hall]) : null;
  return net === null ? c.dailyUsd : c.th * net;
}

// A Smart Mining miner with a smoothing reserve (lib/smart.js): what the whole UTC day `day` pays, worked out from the first
// day of its term so the reserve carries over. Part days at the start and end of the term are weighted by how much of them is
// inside the term. The last day also carries the user's share of what is left in the reserve, once the term has ended.
// Returns { usd, full } where full is the part of the day inside the term (ms), for the caller to scale a day still running.
function reserveDay(c, start, day, now, market) {
  const today = utcDay(now);
  const termEnd = start + c.days * DAY;
  const first = utcDay(start);
  const idx = Math.round((day - first) / DAY);
  const lastIdx = Math.floor((termEnd - 1 - first) / DAY);
  const upto = Math.min(idx, lastIdx);
  const ratios = [];
  const weights = [];
  for (let i = 0; i <= upto; i += 1) {
    const d = first + i * DAY;
    ratios.push(smartRatio(market?.smart, d, today));
    weights.push(Math.max(0, Math.min(d + DAY, termEnd) - Math.max(d, start)) / DAY);
  }
  const s = smartSeries(c, ratios, weights);
  let usd = s.days[idx] ?? 0;
  if (idx === lastIdx && now >= termEnd) usd += smartSettle(c, s.left).user;
  const full = Math.max(0, Math.min(day + DAY, termEnd) - Math.max(day, start));
  return { usd, full };
}

// USD earned on one UTC day by all miners.
function usdOn(contracts, starts, day, now, market) {
  const today = utcDay(now);
  const mk = dayMarket(market, day, today);
  return contracts.reduce((sum, c, i) => {
    const a = Math.max(day, starts[i]);
    const b = Math.min(day + DAY, stopOf(c, starts[i], now));
    if (b <= a) return sum;
    if (c.smart && c.reserve) {
      const r = reserveDay(c, starts[i], day, now, market);
      return r.full > 0 ? sum + (r.usd * (b - a)) / r.full : sum;
    }
    return sum + (perDay(c, mk, market, day, today) * (b - a)) / DAY;
  }, 0);
}

// A whole day of one miner at the market of `day` (used by the invite rewards, which share in the friend's payouts).
export function usdPerDay(c, day, market, now = Date.now()) {
  const d = utcDay(day);
  const t = utcDay(now);
  return perDay(c, dayMarket(market, d, t), market, d, t);
}

// Each miner with dailyUsd set to what it is expected to pay today at the live market (the screens show that number).
// Without a live market, or for a hall with no stated rates, the miner is returned as it is.
export function withLiveDaily(contracts, market) {
  if (!market?.live) return contracts;
  const today = utcDay(Date.now());
  return contracts.map((c) => {
    if (c.smart) return { ...c, dailyUsd: r2(smartUsd(c.budget, c.baseYield, smartRatio(market.smart, today, today))) };
    const net = netPerThDay(market.live.gross, market.halls?.[c.hall]);
    return net === null ? c : { ...c, dailyUsd: r2(c.th * net) };
  });
}

// `telemetry` is { samples } when the charts are real (what the halls reported, see lib/telemetry.js), null for the made-up charts.
export function buildEarnings(contracts, now = Date.now(), btcUsd = BTC_USD, market = null, telemetry = null) {
  const today = utcDay(now);
  const starts = contracts.map((c) => startOf(c, now));
  const hasMiners = contracts.length > 0;
  const first = hasMiners ? utcDay(Math.min(...starts)) : today;
  const usdRaw = (day) => usdOn(contracts, starts, day, now, market);
  const usd = (day) => r2(usdRaw(day));

  // Last 7 days, and everything since the first miner (at least 14 days so a new account still draws a line).
  const week = Array.from({ length: 7 }, (_, i) => {
    const day = today - (6 - i) * DAY;
    return { label: i === 6 ? 'Today' : weekdayText(day), day: dayText(day), usd: usd(day), ...(i === 6 ? { partial: true } : {}) };
  });
  const span = Math.min(90, Math.max(14, Math.round((today - first) / DAY) + 1));
  const all = Array.from({ length: span }, (_, i) => {
    const day = today - (span - 1 - i) * DAY;
    return { label: String(new Date(day).getUTCDate()), day: dayText(day), usd: usd(day), ...(i === span - 1 ? { partial: true } : {}) };
  });

  // Average per day over the last 7 days, counting only the time the miners have been live (a miner bought
  // an hour ago is not averaged over 7 days). At least one hour, so a brand-new miner does not blow it up.
  const weekStart = today - 6 * DAY;
  const liveFrom = hasMiners ? Math.max(weekStart, Math.min(...starts)) : now;
  const liveDays = Math.max(1 / 24, (now - liveFrom) / DAY);
  const avgUsd = hasMiners ? week.reduce((s, w) => s + w.usd, 0) / liveDays : 0;

  // Everything the miners have earned since they started, up to this moment. Each day is turned into BTC at that
  // day's own price, so a finished day never moves when the price does.
  let totalUsd = 0;
  let totalBtc = 0;
  for (let day = first; day <= today; day += DAY) {
    const u = usdRaw(day);
    totalUsd += u;
    totalBtc += u / btcOn(market, day, today, btcUsd);
  }

  const totalTh = r1(contracts.filter((c) => c.online !== false).reduce((s, c) => s + c.th, 0));
  // Smart Mining has no TH/s, so its size on the dashboard is the budget it was bought with.
  const smartBudget = contracts.filter((c) => c.online !== false && c.smart).reduce((s, c) => s + (Number(c.budget) || 0), 0);

  // Hashrate over the last 24 hours, one point every 3 hours. Real charts use the reported samples and are empty
  // until some arrive; the made-up ones follow the contracted TH/s with a small fixed wobble.
  const miners = contracts.map((c, k) => ({ serial: c.serial, th: c.th, start: starts[k], stop: stopOf(c, starts[k], now) }));
  const hash = telemetry ? realHash(miners, telemetry.samples, now) || [] : Array.from({ length: 8 }, (_, i) => {
    const t = now - (7 - i) * 3 * HOUR;
    const th = contracts.reduce(
      (s, c, k) => (t >= starts[k] && t <= stopOf(c, starts[k], now) ? s + c.th * (1 - ((i * 7 + Math.floor(c.th * 2)) % 5) * 0.004) : s),
      0
    );
    return r1(th);
  });

  // Uptime per day for the last 7 days: 99.6 to 100 while a miner is live, and the average of those days.
  const days = Array.from({ length: 7 }, (_, i) => today - (6 - i) * DAY);
  const liveDay = days.map((day) => contracts.some((c, k) => day + DAY > starts[k] && day < stopOf(c, starts[k], now)));
  // Real: counted from the reported samples, one figure per day (null where nothing could be counted) and no average
  // when there is nothing to count.
  const realUp = telemetry ? uptimeOf(miners, telemetry.samples, now) : null;
  const uptime = realUp ? realUp.series.map((d) => d.pct) : days.map((day, i) => (liveDay[i] ? r1(100 - (((day / DAY) * 7 + Math.floor(totalTh * 2)) % 5) * 0.1) : 100));
  const upLive = uptime.filter((_, i) => liveDay[i]);
  const uptimePct = realUp ? realUp.pct : upLive.length ? r1(upLive.reduce((s, v) => s + v, 0) / upLive.length) : null;

  return {
    hasMiners,
    totalTh,
    smartBudget,
    todayBtc: usdRaw(today) / btcOn(market, today, today, btcUsd),
    totalBtc,
    totalUsd,
    avgUsd,
    uptime: totalTh === 0 && smartBudget > 0 ? null : uptimePct, // Smart Mining has no machines, so there is no uptime to show
    earnings: { week, all },
    stats: { hash, uptime },
    chartsReal: !!telemetry,
  };
}

// The finished days of one miner, newest first, for its own page: { rows: [{ day: '17 Oct', usd, btc }], usd, btc }.
// A day the miner was live but earned nothing (costs above the day's hashprice) is still listed, at $0.
export function minerDaily(c, now = Date.now(), market = null, btcUsd = BTC_USD, limit = 400) {
  const start = startOf(c, now);
  const stop = stopOf(c, start, now);
  const today = utcDay(now);
  const rows = [];
  let usd = 0;
  let btc = 0;
  for (let day = today - DAY; day >= utcDay(start) && rows.length < limit; day -= DAY) {
    if (!(day + DAY > start && day < stop)) continue;
    const u = usdOn([c], [start], day, now, market);
    const b = u / btcOn(market, day, today, btcUsd);
    usd += u;
    btc += b;
    rows.push({ day: dayText(day), usd: r2(u), btc: b });
  }
  return { rows, usd, btc };
}

// Finished payout days, newest first: one row per UTC day (today is not paid yet), paid at 00:00 UTC the next day.
// `limit` keeps the wallet list short; the total earned always counts every day.
export function payoutDays(contracts, now = Date.now(), btcUsd = BTC_USD, limit = 30, market = null) {
  if (!contracts.length) return [];
  const today = utcDay(now);
  const starts = contracts.map((c) => startOf(c, now));
  const first = utcDay(Math.min(...starts));
  const out = [];
  for (let day = today - DAY; day >= first && out.length < limit; day -= DAY) {
    const usd = usdOn(contracts, starts, day, now, market);
    if (usd > 0) out.push({ at: day + DAY, btc: usd / btcOn(market, day, today, btcUsd) });
  }
  return out;
}
