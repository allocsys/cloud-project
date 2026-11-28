// Numbers for the Earnings page, worked out from the user's own miners.
// Pure (no storage), so it runs on the server and could run in the browser too.
// Payout days run 00:00 to 24:00 UTC, the same as the payout countdown.
//
// What a day pays comes from the market of that day (see lib/market.js): net per TH/s = gross hashprice minus the hall's
// electricity and maintenance, never below zero. `market` is { days: { [utcMidnightMs]: { gross, btc } }, live, halls }:
//   days   the saved snapshot of every finished day (lib/server/market.js). A finished day never changes.
//   live   the current market, used for today only
//   halls  the catalogue's halls, for their electricity and maintenance
// A finished day is saved on the miner (freezeDays, written by lib/server/earnlog.js) and from then on is read, never worked out
// again: c.log = { [UTC day number]: [usd paid, BTC price, usd of a whole day, Smart reserve left] } (rounded, see money/price), c.logTo = the last day saved.
//
// A day with no market data falls back to the last saved snapshot before it (up to CARRY_DAYS back), and only then to the
// miner's own static dailyUsd and the static BTC price.
import { BTC_USD } from '@/lib/data';
import { netPerThDay } from '@/lib/market';
import { realHash, uptimeOf } from '@/lib/telemetry';
import { ratioOf, pickCoin, smartDaily, SMART_FLAT_FROM, SMART_LOSS_FROM, lostDay, smartSeries, smartSettle, anchorFor } from '@/lib/smart';
import { smartRateAt, smartWeight } from '@/lib/smart-halls';
import { isPaused, scopeOf, termEnd, pausedDays } from '@/lib/guard';

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

// When a miner stops earning: its term ends, or it went offline (offline counts from the start of today). `guard` is
// market.guard (lib/guard.js): days the profit guard paused push the end of an 'extend' miner's term back.
export function stopOf(c, start, now, guard = null, end = termEnd(c, start, guard)) {
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

const saved = (c, day) => c.log?.[day / DAY];
// What a saved day keeps is rounded (USD to 8 decimals, the BTC price to cents): the account document carries one row per miner day,
// and the figures are far finer than anything shown or paid (cents, and BTC to 8 decimals), so full-length floats only cost space.
const money = (n) => Math.round(n * 1e8) / 1e8;
const price = (n) => Math.round(n * 100) / 100;

// BTC price a day is converted at.
export const btcOn = (market, day, today, fallback) => dayMarket(market, day, today)?.btc || fallback;

// How a day's picked coin compares with its reference (lib/smart.js), 1 = as priced. `sm` is market.smart:
//   picks  { [utcMidnightMs]: coin }, the locked pick of every finished day
//   days   { [utcMidnightMs]: { [coin]: gross } }, the saved market of every finished day
//   refs   { [coin]: gross }, what each coin is measured against
//   live   { [coin]: gross } now, used for today only (null when the feeds are down)
//   prev   the coin of the latest finished day, which today's pick holds inside the hysteresis
// A day on which every coin loses money (from SMART_LOSS_FROM) pays ratio 0: the principal share only, and the reserve may top the profit up.
// A day with no figures at all (feeds down, server down) is a different case: it carries forward the nearest earlier day's ratio (up to CARRY_DAYS), and only then pays at 1.
function smartRatio(sm, day, today) {
  if (!sm) return 1;
  const loss = day >= SMART_LOSS_FROM;
  if (day === today && sm.live) {
    const anchor = anchorFor(sm, day);
    const ratios = {};
    for (const [coin, g] of Object.entries(sm.live)) ratios[coin] = ratioOf(g, anchor);
    const coin = pickCoin(ratios, sm.prev ?? null);
    if (coin) return ratios[coin];
    if (loss && anchor > 0 && lostDay(sm.live)) return 0;
  }
  for (let k = day === today ? 1 : 0; k <= CARRY_DAYS; k += 1) {
    const d = day - k * DAY;
    const coin = sm.picks?.[d];
    const r = coin ? ratioOf(sm.days?.[d]?.[coin], anchorFor(sm, d)) : null;
    if (r) return r;
    if (k === 0 && loss && anchorFor(sm, d) > 0 && lostDay(sm.days?.[d])) return 0;
  }
  return 1;
}

// The coin a Smart Mining miner mines today: the live pick (held inside the hysteresis), else the latest saved pick. Null when unknown.
function smartCoin(sm, today) {
  if (!sm) return null;
  if (sm.live) {
    const ratios = {};
    for (const [coin, g] of Object.entries(sm.live)) ratios[coin] = ratioOf(g, sm.refs?.[coin]);
    const coin = pickCoin(ratios, sm.prev ?? null);
    if (coin) return coin;
  }
  for (let k = 1; k <= CARRY_DAYS; k += 1) if (sm.picks?.[today - k * DAY]) return sm.picks[today - k * DAY];
  return null;
}

// What one miner pays for a whole day at market `mk`: th x net rate, or its static dailyUsd when there is no market
// or its hall does not state its rates. A Smart Mining contract (c.smart) pays its principal share flat plus its profit part x the
// day's coin ratio (lib/smart.js smartDaily; days before SMART_FLAT_FROM were paid budget x base yield x ratio).
function perDay(c, mk, market, day, today) {
  if (c.smart) return smartDaily(c, smartRatio(market?.smart, day, today), day);
  const net = mk ? netPerThDay(mk.gross, market.halls?.[c.hall], day) : null;
  return net === null ? c.dailyUsd : c.th * net;
}

// A Smart Mining miner with a smoothing reserve (lib/smart.js): what the whole UTC day `day` pays, worked out from the first
// day of its term so the reserve carries over. Part days at the start and end of the term are weighted by how much of them is
// inside the term. The last day also carries the user's share of what is left in the reserve, once the term has ended.
// Returns { usd, full } where full is the part of the day inside the term (ms), for the caller to scale a day still running.
// Each day only depends on the days before it, so the series is built once for the whole term and kept for the same
// miner, start, `now` and market (a chart asks for every day in turn); any other call builds it again.
const reserveCache = new WeakMap();
function reserveSeries(c, start, now, market) {
  const hit = reserveCache.get(c);
  if (hit && hit.now === now && hit.start === start && hit.market === market) return hit;
  const today = utcDay(now);
  const guard = market?.guard;
  const end = termEnd(c, start, guard); // the term's end, pushed back by days the profit guard paused
  const first = utcDay(start);
  const lastIdx = Math.floor((end - 1 - first) / DAY);
  const ratios = [];
  const weights = [];
  const off = [];
  const flat = [];
  // Saved days are not worked out again: the series carries on after the last one, from the reserve it left.
  const done = Number.isFinite(c.logTo) ? Math.max(0, Math.min(lastIdx + 1, c.logTo - first / DAY + 1)) : 0;
  const carried = done ? saved(c, first + (done - 1) * DAY)?.[3] : null;
  for (let i = done; i <= lastIdx; i += 1) {
    const d = first + i * DAY;
    ratios.push(smartRatio(market?.smart, d, today));
    weights.push(Math.max(0, Math.min(d + DAY, end) - Math.max(d, start)) / DAY);
    off.push(isPaused(guard, scopeOf(c), d));
    flat.push(d >= SMART_FLAT_FROM);
  }
  const s = smartSeries(c, ratios, weights, off, flat, carried);
  const pad = (list) => [...Array(done).fill(0), ...list];
  const out = { now, start, market, end, first, lastIdx, s: { days: pad(s.days), lefts: pad(s.lefts), left: s.left } };
  reserveCache.set(c, out);
  return out;
}

function reserveDay(c, start, day, now, market) {
  const { end, first, lastIdx, s } = reserveSeries(c, start, now, market);
  const idx = Math.round((day - first) / DAY);
  let usd = idx <= lastIdx ? (s.days[idx] ?? 0) : 0;
  if (idx === lastIdx && now >= end) usd += smartSettle(c, s.left).user;
  const full = Math.max(0, Math.min(day + DAY, end) - Math.max(day, start));
  return { usd, full };
}

// What all miners earned on one UTC day: { usd, btc }. A saved day is read as it was saved. `ends` (optional) holds each miner's term end,
// for a caller that goes through many days of one miner and so works it out once (termEnd walks the whole term).
function partsOn(contracts, starts, day, now, market, btcUsd = BTC_USD, ends = null) {
  const today = utcDay(now);
  const mk = dayMarket(market, day, today);
  let savedUsd = 0;
  let savedBtc = 0;
  const live = contracts.reduce((sum, c, i) => {
    const kept = saved(c, day);
    if (kept) {
      savedUsd += kept[0];
      savedBtc += kept[0] / kept[1];
      return sum;
    }
    const a = Math.max(day, starts[i]);
    const b = Math.min(day + DAY, stopOf(c, starts[i], now, market?.guard, ends?.[i]));
    if (b <= a) return sum;
    if (market?.guard && isPaused(market.guard, scopeOf(c), day)) return sum; // switched off that day by the profit guard
    if (c.smart && c.reserve) {
      const r = reserveDay(c, starts[i], day, now, market);
      return r.full > 0 ? sum + (r.usd * (b - a)) / r.full : sum;
    }
    return sum + (perDay(c, mk, market, day, today) * (b - a)) / DAY;
  }, 0);
  return { usd: live + savedUsd, btc: live / btcOn(market, day, today, btcUsd) + savedBtc };
}

// A whole day of one miner at the market of `day` (used by the invite rewards, which share in the friend's payouts).
export function usdPerDay(c, day, market, now = Date.now()) {
  const d = utcDay(day);
  const t = utcDay(now);
  if (saved(c, d)) return saved(c, d)[2];
  if (market?.guard && isPaused(market.guard, scopeOf(c), d)) return 0;
  return perDay(c, dayMarket(market, d, t), market, d, t);
}

// The BTC price of one miner's day: the saved one, else the price of that day's market.
export const dayPrice = (c, day, market, now = Date.now()) => saved(c, utcDay(day))?.[1] ?? btcOn(market, utcDay(day), utcDay(now), BTC_USD);

// Saves the finished days of miner `c` that are not saved yet, up to `upto` (the start of a UTC day whose market, coin pick and
// guard decision are final). Changes `c` and returns how many days it saved. Days are saved to the end of the term, and on to
// `invite.until` when invite rewards read days after it. c.logDone marks a miner with nothing left to save; invite.open true
// (the invite rewards have not started yet) holds that back. A sample miner with no start time, or an offline one, is left alone.
export function freezeDays(c, now, market, upto, invite = {}) {
  if (!Number.isFinite(c.startedAt) || c.online === false || c.logDone) return 0;
  const start = c.startedAt;
  const first = utcDay(start);
  const end = termEnd(c, start, market?.guard);
  const last = Math.max(utcDay(end - 1), invite.until ? utcDay(invite.until - 1) : 0);
  const add = [];
  for (let day = Number.isFinite(c.logTo) ? (c.logTo + 1) * DAY : first; day <= Math.min(upto, last); day += DAY) {
    const usd = partsOn([c], [start], day, now, market, BTC_USD, [end]).usd;
    const row = [money(usd), price(btcOn(market, day, utcDay(now), BTC_USD)), money(usdPerDay(c, day, market, now))];
    if (c.smart && c.reserve && day < end) row.push(money(reserveSeries(c, start, now, market).s.lefts[(day - first) / DAY]));
    add.push([day / DAY, row]);
  }
  // Written after the loop, so every day of this round is worked out from the same saved days.
  if (add.length) {
    c.log = { ...c.log, ...Object.fromEntries(add) };
    c.logTo = add[add.length - 1][0];
    reserveCache.delete(c);
  }
  if (upto >= last && !invite.open) c.logDone = true;
  return add.length;
}

// The days of its term a miner has used up (the "Day N of M" figure): whole days since it went live. A paused day does not
// use up the term of an 'extend' miner, so those are taken off; a 'zero' miner uses them up. Today is not counted until it is over.
export function usedDays(c, now, guard) {
  const gone = Math.max(0, Math.floor((now - c.startedAt) / DAY));
  const held = guard && c.pauseRule !== 'zero' ? pausedDays(c, c.startedAt, utcDay(now), guard) : 0;
  return Math.max(0, Math.min(c.days, gone - held));
}

// Each miner with dailyUsd set to what it is expected to pay today at the live market (the screens show that number).
// Without a live market, or for a hall with no stated rates, the miner is returned as it is.
export function withLiveDaily(contracts, market) {
  const now = Date.now();
  const today = utcDay(now);
  const g = market?.guard;
  // A miner switched off today by the profit guard expects nothing today and is marked paused.
  const off = (c) => (g && isPaused(g, scopeOf(c), today) ? { ...c, dailyUsd: 0, paused: true } : null);
  // Days the guard paused push the end of an 'extend' miner's term back: show the real end date and how many days it moved.
  // Bought miners (they carry elapsed) also get the days they have used up, worked out from the start date.
  const stretch = (c) => {
    if (!Number.isFinite(c.startedAt)) return c;
    let out = c;
    if (Number.isFinite(c.elapsed)) {
      const e = usedDays(c, now, g);
      if (e !== c.elapsed) out = { ...c, elapsed: e };
    }
    if (!g) return out;
    const plain = c.startedAt + c.days * DAY;
    const end = termEnd(c, c.startedAt, g);
    if (end === plain) return out;
    return { ...out, ends: new Date(end).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }), extendedDays: Math.round((end - plain) / DAY) };
  };
  if (!market?.live) return contracts.map((c) => stretch(off(c) || c));
  return contracts.map((c) => {
    const p = off(c);
    if (p) return stretch(p);
    if (c.smart) {
      const coin = smartCoin(market.smart, today);
      return stretch({ ...c, dailyUsd: r2(smartDaily(c, smartRatio(market.smart, today, today), today)), ...(coin ? { coin } : {}) });
    }
    const net = netPerThDay(market.live.gross, market.halls?.[c.hall], today);
    return stretch(net === null ? c : { ...c, dailyUsd: r2(c.th * net) });
  });
}

// `telemetry` is { samples } when the charts are real (what the halls reported, see lib/telemetry.js), null for the made-up charts.
export function buildEarnings(contracts, now = Date.now(), btcUsd = BTC_USD, market = null, telemetry = null) {
  const today = utcDay(now);
  const starts = contracts.map((c) => startOf(c, now));
  const hasMiners = contracts.length > 0;
  const first = hasMiners ? utcDay(Math.min(...starts)) : today;
  const usdRaw = (day) => partsOn(contracts, starts, day, now, market).usd;
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
    const p = partsOn(contracts, starts, day, now, market, btcUsd);
    totalUsd += p.usd;
    totalBtc += p.btc;
  }

  const totalTh = r1(contracts.filter((c) => c.online !== false).reduce((s, c) => s + c.th, 0));
  // Smart Mining has no TH/s, so its size on the dashboard is the budget it was bought with.
  const smartBudget = contracts.filter((c) => c.online !== false && c.smart).reduce((s, c) => s + (Number(c.budget) || 0), 0);

  // Hashrate over the last 24 hours, one point every 3 hours. Real charts use the reported samples and are empty
  // until some arrive; the made-up ones follow the contracted TH/s with a small fixed wobble.
  // A Smart Mining miner is measured against its contracted hashrate of each day's coin (lib/smart-halls.js).
  const miners = contracts.map((c, k) => ({
    serial: c.serial,
    th: c.th,
    start: starts[k],
    stop: stopOf(c, starts[k], now, market?.guard),
    ...(c.smart ? { rateAt: (h) => smartRateAt(c, market?.smart, h, now), weight: smartWeight(c) } : {}),
    ...(market?.guard ? { off: (h) => isPaused(market.guard, scopeOf(c), utcDay(h)) } : {}),
  }));
  const hash = telemetry ? realHash(miners, telemetry.samples, now) || [] : Array.from({ length: 8 }, (_, i) => {
    const t = now - (7 - i) * 3 * HOUR;
    const th = contracts.reduce(
      (s, c, k) => (t >= starts[k] && t <= stopOf(c, starts[k], now, market?.guard) ? s + c.th * (1 - ((i * 7 + Math.floor(c.th * 2)) % 5) * 0.004) : s),
      0
    );
    return r1(th);
  });

  // Uptime per day for the last 7 days: 99.6 to 100 while a miner is live, and the average of those days.
  const days = Array.from({ length: 7 }, (_, i) => today - (6 - i) * DAY);
  const liveDay = days.map((day) => contracts.some((c, k) => day + DAY > starts[k] && day < stopOf(c, starts[k], now, market?.guard) && !(market?.guard && isPaused(market.guard, scopeOf(c), day))));
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
    uptime: uptimePct,
    earnings: { week, all },
    stats: { hash, uptime },
    chartsReal: !!telemetry,
  };
}

// The finished days of one miner, newest first, for its own page: { rows: [{ day: '17 Oct', usd, btc }], usd, btc }.
// A day the miner was live but earned nothing (costs above the day's hashprice) is still listed, at $0.
export function minerDaily(c, now = Date.now(), market = null, btcUsd = BTC_USD, limit = 400) {
  const start = startOf(c, now);
  const stop = stopOf(c, start, now, market?.guard);
  const today = utcDay(now);
  const rows = [];
  let usd = 0;
  let btc = 0;
  for (let day = today - DAY; day >= utcDay(start) && rows.length < limit; day -= DAY) {
    if (!saved(c, day)?.[0] && !(day + DAY > start && day < stop)) continue;
    const { usd: u, btc: b } = partsOn([c], [start], day, now, market, btcUsd);
    usd += u;
    btc += b;
    rows.push({ day: dayText(day), usd: r2(u), btc: b, ...(market?.guard && isPaused(market.guard, scopeOf(c), day) ? { paused: true } : {}) });
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
    const p = partsOn(contracts, starts, day, now, market, btcUsd);
    if (p.usd > 0) out.push({ at: day + DAY, btc: p.btc });
  }
  return out;
}
