// Numbers for the Earnings page, worked out from the user's own miners.
// Pure (no storage), so it runs on the server and could run in the browser too.
// Payout days run 00:00 to 24:00 UTC, the same as the payout countdown.
import { BTC_USD } from '@/lib/data';

const DAY = 86400000;
const HOUR = 3600000;
const utcDay = (t) => Math.floor(t / DAY) * DAY;
const dayText = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const weekdayText = (t) => new Date(t).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;

// When a miner went live. Miners bought in the app carry startedAt; the sample ones only have a date like "2 Oct".
function startOf(c, now) {
  if (Number.isFinite(c.startedAt)) return c.startedAt;
  const y = new Date(now).getUTCFullYear();
  let t = Date.parse(`${c.started} ${y} 00:00 UTC`);
  if (Number.isFinite(t) && t > now) t = Date.parse(`${c.started} ${y - 1} 00:00 UTC`);
  return Number.isFinite(t) ? t : utcDay(now) - (c.elapsed || 0) * DAY;
}

// When a miner stops earning: its term ends, or it went offline (offline counts from the start of today).
function stopOf(c, start, now) {
  const end = start + c.days * DAY;
  return c.online === false ? Math.min(end, utcDay(now)) : Math.min(end, now);
}

// USD earned on one UTC day by all miners. A small steady wobble keeps the days from looking identical.
function usdOn(contracts, starts, day, now) {
  return contracts.reduce((sum, c, i) => {
    const a = Math.max(day, starts[i]);
    const b = Math.min(day + DAY, stopOf(c, starts[i], now));
    if (b <= a) return sum;
    const wobble = 1 + ((((day / DAY) * 7 + Math.floor(c.th * 2)) % 5) - 2) * 0.012;
    return sum + ((c.dailyUsd * (b - a)) / DAY) * wobble;
  }, 0);
}

export function buildEarnings(contracts, now = Date.now(), btcUsd = BTC_USD) {
  const today = utcDay(now);
  const starts = contracts.map((c) => startOf(c, now));
  const hasMiners = contracts.length > 0;
  const first = hasMiners ? utcDay(Math.min(...starts)) : today;
  const usd = (day) => r2(usdOn(contracts, starts, day, now));

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

  const totalTh = r1(contracts.filter((c) => c.online !== false).reduce((s, c) => s + c.th, 0));

  // Hashrate over the last 24 hours, one point every 3 hours.
  const hash = Array.from({ length: 8 }, (_, i) => {
    const t = now - (7 - i) * 3 * HOUR;
    const th = contracts.reduce(
      (s, c, k) => (t >= starts[k] && t <= stopOf(c, starts[k], now) ? s + c.th * (1 - ((i * 7 + Math.floor(c.th * 2)) % 5) * 0.004) : s),
      0
    );
    return r1(th);
  });

  // Uptime per day for the last 7 days: 99.6 to 100 while a miner is live, and the average of those days.
  const days = Array.from({ length: 7 }, (_, i) => today - (6 - i) * DAY);
  const liveDays = days.map((day) => contracts.some((c, k) => day + DAY > starts[k] && day < stopOf(c, starts[k], now)));
  const uptime = days.map((day, i) => (liveDays[i] ? r1(100 - (((day / DAY) * 7 + Math.floor(totalTh * 2)) % 5) * 0.1) : 100));
  const upLive = uptime.filter((_, i) => liveDays[i]);
  const uptimePct = upLive.length ? r1(upLive.reduce((s, v) => s + v, 0) / upLive.length) : null;

  return {
    hasMiners,
    totalTh,
    todayBtc: week[6].usd / btcUsd,
    uptime: uptimePct,
    earnings: { week, all },
    stats: { hash, uptime },
  };
}
