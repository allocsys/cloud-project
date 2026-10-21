// Hashrate and uptime for the charts, in two flavours. The admin's "mock charts" switch picks one:
//   mock  made-up numbers: the contracted hashrate with a small fixed wobble, and 99.6 to 100 % uptime while a miner is live.
//   real  worked out from hash_samples: the TH/s each miner's hall reports (POST /api/telemetry).
// Pure (no storage), so it runs on the server and in tests.
//
// A miner here is { serial, th, start, stop } (ms): its contracted TH/s, when it went live and when it stops earning.
// A Smart Mining miner (lib/smart-halls.js) also has rateAt(hourMs), its contracted hashrate in the unit of the coin it is on
// that hour (null when unknown), and weight, what it counts for in the fleet uptime (TH/s worth of ASIC power, since its own
// unit changes with the coin). Without rateAt the contracted rate is th, as for ASICs.
// samples is { [serial]: [{ at, th }] }, oldest first.
//
// How real numbers are read:
//   - Monitoring starts at a miner's first sample. Time before that is unknown, not down, so it is left out.
//   - An hour counts as up when at least one sample in it reached UP_RATIO of the contracted TH/s.
//   - A monitored, live hour with no good sample counts as down.
//   - Only whole hours that are over are counted, so a fresh hour never shows as down before its first sample.
//   - A day with no counted hours has no figure (null). Nothing is invented.
const HOUR = 3600000;
const DAY = 86400000;
export const UP_RATIO = 0.9;

const utcHour = (t) => Math.floor(t / HOUR) * HOUR;
const utcDay = (t) => Math.floor(t / DAY) * DAY;
const r1 = (n) => Math.round(n * 10) / 10;
const weekday = (t) => new Date(t).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
const dayText = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

const rateOf = (m) => m.rateAt || (() => m.th);
const weightOf = (m) => (Number.isFinite(m.weight) ? m.weight : m.th);

// Per hour: how many samples, their sum, and whether one reached UP_RATIO of the contracted rate for that hour.
// rateAt(hourMs) is the contracted rate, or null when it is not known (no sample can count as up then).
function hourly(list, rateAt) {
  const m = new Map();
  for (const s of list) {
    const h = utcHour(s.at);
    const b = m.get(h) || { n: 0, sum: 0, up: false };
    b.n += 1;
    b.sum += s.th;
    const need = rateAt(h);
    if (need !== null && s.th >= need * UP_RATIO) b.up = true;
    m.set(h, b);
  }
  return m;
}

// Average of the samples with a <= at < b, or null when there are none.
function avgIn(list, a, b) {
  let n = 0;
  let sum = 0;
  for (const s of list) {
    if (s.at >= a && s.at < b) {
      n += 1;
      sum += s.th;
    }
  }
  return n ? sum / n : null;
}

// ---- Real ----

// Fleet hashrate over the last 24 hours, one point every 3 hours, as the sum of what each miner reported.
// Null when nothing was reported in that time, so the screen can say "no data" instead of a flat zero line.
// Smart Mining miners are left out: their unit changes with the coin, so their hashrate cannot be added to TH/s.
export function realHash(miners, samples, now) {
  miners = miners.filter((m) => !m.rateAt);
  const from = now - 24 * HOUR;
  if (!miners.some((m) => (samples[m.serial] || []).some((s) => s.at >= from && s.at <= now))) return null;
  return Array.from({ length: 8 }, (_, i) => {
    const t = now - (7 - i) * 3 * HOUR;
    let th = 0;
    for (const m of miners) {
      const list = samples[m.serial] || [];
      if (!list.length || t <= list[0].at || t < m.start || t > m.stop) continue;
      th += avgIn(list, t - 3 * HOUR, t) ?? 0;
    }
    return r1(th);
  });
}

// Uptime for the last 7 days, weighted by contracted TH/s. { series: [{ label, day, pct }], pct } with pct null when
// there is nothing to count. Works for the whole fleet or, with one miner, for that miner.
export function uptimeOf(miners, samples, now) {
  const today = utcDay(now);
  const done = utcHour(now); // hours that start before this are over
  const prepared = miners.map((m) => {
    const list = samples[m.serial] || [];
    return { m, first: list.length ? utcHour(list[0].at) : null, hrs: hourly(list, rateOf(m)) };
  });
  let allLive = 0;
  let allUp = 0;
  const series = Array.from({ length: 7 }, (_, i) => {
    const day = today - (6 - i) * DAY;
    let live = 0;
    let up = 0;
    for (const { m, first, hrs } of prepared) {
      if (first === null) continue;
      for (let h = day; h < day + DAY && h < done; h += HOUR) {
        if (h < first || h < m.start || h + HOUR > m.stop) continue;
        if (m.rateAt && m.rateAt(h) === null) continue; // the contract of that hour is not known, so nothing is counted
        live += weightOf(m);
        if (hrs.get(h)?.up) up += weightOf(m);
      }
    }
    allLive += live;
    allUp += up;
    return { label: i === 6 ? 'Today' : weekday(day), day: dayText(day), pct: live ? r1((100 * up) / live) : null };
  });
  return { series, pct: allLive ? r1((100 * allUp) / allLive) : null };
}

// One miner's hashrate over the last 24 hours, one point per hour: { series, now, hasData }.
// now is the latest reading when it is under 30 minutes old, and 0 otherwise.
export function realMinerHash(m, list, now) {
  const hrs = hourly(list, rateOf(m));
  const cur = utcHour(now);
  const series = Array.from({ length: 24 }, (_, i) => {
    const b = hrs.get(cur - (23 - i) * HOUR);
    return b ? r1(b.sum / b.n) : 0;
  });
  const last = list[list.length - 1];
  return {
    series,
    now: last && now - last.at <= 30 * 60000 ? r1(last.th) : 0,
    hasData: list.some((s) => s.at >= cur - 23 * HOUR),
  };
}

// ---- Mock (the numbers the app showed before real data existed) ----

export function mockMinerHash(c) {
  const series = Array.from({ length: 24 }, (_, i) => (c.online ? +(c.th * (1 - ((i * 7 + c.th) % 5) * 0.004)).toFixed(1) : 0));
  return { series, now: series[series.length - 1], hasData: true };
}

export function mockMinerUptime(m, now) {
  const today = utcDay(now);
  const series = Array.from({ length: 7 }, (_, i) => {
    const day = today - (6 - i) * DAY;
    const live = day + DAY > m.start && day < m.stop;
    return { label: i === 6 ? 'Today' : weekday(day), day: dayText(day), pct: live ? r1(100 - (((day / DAY) * 7 + Math.floor(m.th * 2)) % 5) * 0.1) : null };
  });
  const got = series.filter((d) => d.pct !== null);
  return { series, pct: got.length ? r1(got.reduce((s, d) => s + d.pct, 0) / got.length) : null };
}

// What one miner's page draws. `list` is that miner's samples, or null for mock mode. `rateAt` is a Smart Mining miner's
// contracted hashrate by hour (see above); the made-up chart then follows today's rate.
export function minerCharts(c, start, stop, list, now, rateAt = null) {
  const m = { serial: c.serial, th: c.th, start, stop, ...(rateAt ? { rateAt, weight: 1 } : {}) };
  if (!list) {
    const mc = rateAt ? { ...c, th: rateAt(utcHour(now)) ?? 0 } : c;
    return { real: false, hash: mockMinerHash(mc), uptime: mockMinerUptime(m, now) };
  }
  return { real: true, hash: realMinerHash(m, list, now), uptime: uptimeOf([m], { [c.serial]: list }, now) };
}
