// Real hashrate samples and the "mock charts" switch. The maths lives in lib/telemetry.js.
//
//   The switch   meta entry "flags" { mockCharts }. On (the default) the charts show the made-up numbers; off, they show
//                what the halls reported. The admin flips it in the Overview tab. A change reaches every server within
//                a few seconds (the meta cache).
//   The feed     a hall's monitoring posts { samples: [{ serial, th, at? }] } to /api/telemetry with the key from
//                TELEMETRY_KEY (16 or more characters; without it the endpoint stays off). One row per miner and
//                moment in hash_samples; rows older than KEEP_DAYS are deleted.
import { timingSafeEqual, createHash } from 'node:crypto';
import { q, warm, metaGet, metaUpdate } from '@/lib/server/db';

const DAY = 86400000;
const KEEP_DAYS = 100;
const WINDOW = 8 * DAY; // the charts look back 7 days
const MAX_BATCH = 1000;
const FUTURE_SLACK = 5 * 60000;
const SERIAL = /^OP-\d{7}$/;

export const feedEnabled = () => (process.env.TELEMETRY_KEY || '').length >= 16;

const sha = (s) => createHash('sha256').update(String(s)).digest();
export const checkKey = (k) => feedEnabled() && timingSafeEqual(sha(k ?? ''), sha(process.env.TELEMETRY_KEY));

// True while the charts should show made-up numbers. Mock until an admin switches it off.
export async function mockCharts() {
  await warm();
  return metaGet('flags')?.mockCharts !== false;
}

export function setMockCharts(on) {
  return metaUpdate('flags', (cur) => ({ value: { ...(cur || {}), mockCharts: !!on }, result: !!on }));
}

// Samples of the given miners from the last 8 days, { [serial]: [{ at, th }] } oldest first. Empty for no serials.
export async function loadSamples(serials, now = Date.now()) {
  const out = {};
  if (!serials.length) return out;
  const r = await q('SELECT serial, at, th FROM hash_samples WHERE serial = ANY($1::text[]) AND at > $2 AND at <= $3 ORDER BY at', [serials, now - WINDOW, now + FUTURE_SLACK]);
  for (const row of r.rows) (out[row.serial] ||= []).push({ at: Number(row.at), th: Number(row.th) });
  return out;
}

// What the screens pass on to lib/earnings.js and lib/telemetry.js: null in mock mode, { samples } in real mode.
// If the samples cannot be read, real mode shows "no data" rather than falling back to made-up numbers.
export async function telemetryFor(contracts, now = Date.now()) {
  if (await mockCharts()) return null;
  try {
    return { samples: await loadSamples(contracts.map((c) => c.serial), now) };
  } catch (e) {
    console.error('[telemetry] could not read samples:', e.message);
    return { samples: {} };
  }
}

let lastPrune = 0;

// Saves a batch from the feed. Bad rows are skipped and counted. Returns { accepted, rejected }.
export async function ingest(list, now = Date.now()) {
  const rows = new Map();
  let rejected = 0;
  for (const s of Array.isArray(list) ? list.slice(0, MAX_BATCH) : []) {
    const serial = String(s?.serial ?? '');
    const th = Number(s?.th);
    const at = s?.at === undefined ? now : Number(s.at);
    if (!SERIAL.test(serial) || !Number.isFinite(th) || th < 0 || th > 1e6 || !Number.isInteger(at) || at < now - WINDOW || at > now + FUTURE_SLACK) {
      rejected += 1;
      continue;
    }
    rows.set(`${serial}:${at}`, { serial, at, th: Math.round(th * 1000) / 1000 });
  }
  if (Array.isArray(list) && list.length > MAX_BATCH) rejected += list.length - MAX_BATCH;
  // One fixed order for every server, so two overlapping batches take their row locks in the same sequence.
  const v = [...rows.values()].sort((a, b) => (a.serial < b.serial ? -1 : a.serial > b.serial ? 1 : a.at - b.at));
  if (v.length) {
    await q(
      `INSERT INTO hash_samples (serial, at, th) SELECT * FROM unnest($1::text[], $2::bigint[], $3::numeric[])
       ON CONFLICT (serial, at) DO UPDATE SET th = EXCLUDED.th`,
      [v.map((x) => x.serial), v.map((x) => x.at), v.map((x) => x.th)],
    );
  }
  if (now - lastPrune > 3600000) {
    lastPrune = now;
    q('DELETE FROM hash_samples WHERE at < $1', [now - KEEP_DAYS * DAY]).catch((e) => console.error('[telemetry] prune failed:', e.message));
  }
  return { accepted: v.length, rejected };
}

// For the admin screen: is the feed set up, and is anything arriving.
export async function feedStatus(now = Date.now()) {
  let samples = 0;
  let miners = 0;
  let last = null;
  try {
    const r = (await q('SELECT count(*)::int AS n, count(DISTINCT serial)::int AS m, max(at) AS last FROM hash_samples WHERE at > $1', [now - DAY])).rows[0];
    samples = r.n;
    miners = r.m;
    last = r.last === null ? null : Number(r.last);
  } catch (e) {
    console.error('[telemetry] status failed:', e.message);
  }
  return { enabled: feedEnabled(), samples, miners, last };
}
