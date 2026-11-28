// Saves each finished UTC day's earnings on the miner (lib/earnings.js freezeDays), so a later change to a rate, to market data or
// to a formula never moves a day already earned. A server timer: once a day is over and its market, Smart coin pick and guard
// decision are final, every miner with unsaved days gets them. Days missed while the server was down are saved on the next round,
// and the first round after this was added saves every earlier day as it reads then. Safe to repeat and safe on several servers:
// one round runs at a time, each account is written under its row lock, and a saved day is never written again.
// To correct a saved day, an admin changes the account's balance (lib/server/admin.js, 'balance').
// Each UTC day is gone through ONCE: a marker in meta ('earnlogday' = { day, failed }) says the newest day that was gone through and
// which accounts failed. Until the next day closes, a round reads only that one small row, and retries only the failed accounts.
// A miner reopened or given a referral after its day was gone through is picked up by the next day's pass.
import { q, warm, metaGet, metaSet, withUser, exclusive } from '@/lib/server/db';
import { getMarket } from '@/lib/server/market';
import { ensurePicks } from '@/lib/server/smart-market';
import { settings as referralSettings } from '@/lib/server/referrals';
import { freezeDays } from '@/lib/earnings';
import { jitterEvery } from '@/lib/server/jitter';

const DAY = 86400000;
const EVERY = 300_000;
const FIRST = 60_000;
export const GRACE = 900_000; // after 00:00 UTC: late market writes land and the short caches have turned over
const BATCH = 100;
const BATCH_REST = 1000;
const utcDay = (t) => Math.floor(t / DAY) * DAY;
const MARK = 'earnlogday';
const FAILED_MAX = 500; // more failures than this (a database outage): no marker, the next round goes through every account again
const state = (globalThis.__vtxEarnLog ||= { running: false, scan: null });

// The newest day that may be saved at `now`.
export const lastClosed = (now) => utcDay(now - GRACE) - DAY;

// The market to save from, or null while any part of it is not final up to `upto`. getMarket() never throws and falls back when
// something cannot be read, which is fine for a screen but must not be saved, so each part is checked against the database.
async function finalMarket(upto, now) {
  await ensurePicks(now);
  const market = await getMarket();
  await warm(true);
  const guard = metaGet('guarddays');
  if (!guard || !(guard.upto >= upto)) return null;
  const days = (await q('SELECT count(*)::int AS n FROM market_days WHERE day <= $1', [upto])).rows[0].n;
  if (Object.keys(market.days).filter((d) => Number(d) <= upto).length < days) return null;
  const coins = (await q('SELECT 1 FROM coin_days WHERE day <= $1 LIMIT 1', [upto])).rowCount;
  if (coins) {
    const pick = Number((await q('SELECT max(day) AS d FROM smart_picks')).rows[0].d);
    if (!(pick >= upto) || !market.smart?.picks?.[pick]) return null;
  }
  return { ...market, guard: { ...market.guard, paused: guard.paused || {}, smart: guard.smart || {} } };
}

// What the invite rewards still read of miner `c` of account `u` (lib/server/referrals.js friendReward).
function inviteOf(u, c, dailyDays) {
  if (!u.refBy || c.bonus) return {};
  if (!u.refRewardAt) return { open: true };
  const from = Math.max(c.startedAt, u.refRewardAt);
  const until = Math.min(u.refRewardAt + dailyDays * DAY, from + c.days * DAY);
  return until > from ? { until } : {};
}

// The accounts that have a miner with unsaved days up to `upto`. Offline miners are left out (freezeDays skips them and never marks
// them done, so they would be picked every day for nothing). A full read of every account's miners: once a day, see saveClosedDays.
export async function candidateIds(upto) {
  return (
    await q(
      `SELECT id FROM users WHERE EXISTS (
         SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(data->'contracts') = 'array' THEN data->'contracts' ELSE '[]'::jsonb END) k
          WHERE k ? 'startedAt' AND NOT (k ? 'logDone') AND COALESCE(k->>'online', 'true') <> 'false'
            AND COALESCE((k->>'logTo')::int, 0) < $1 AND (k->>'startedAt')::numeric < $2)
        ORDER BY created_at, id`,
      [upto / DAY, upto + DAY],
    )
  ).rows.map((r) => r.id);
}

// Saves every unsaved day up to the last closed one. Returns how many miner days it saved.
export async function saveClosedDays(now = Date.now()) {
  const upto = lastClosed(now);
  const mark = (await q('SELECT data FROM meta WHERE key = $1', [MARK])).rows[0]?.data;
  const gone = mark?.day >= upto; // this day was already gone through (a row of its own, so a change made on another server shows at once)
  if (gone && !mark.failed?.length) return 0;
  let ids = gone ? mark.failed : null;
  if (!ids) {
    // One read of every account per day on this server, also while the day's market is not final yet.
    if (state.scan?.day !== upto) state.scan = { day: upto, ids: await candidateIds(upto) };
    ids = state.scan.ids;
    if (!ids.length) {
      await metaSet(MARK, { day: upto, failed: [] });
      return 0;
    }
  }
  const market = await finalMarket(upto, now);
  if (!market) return 0;
  const { dailyDays } = referralSettings();
  const failed = [];
  let n = 0;
  for (let i = 0; i < ids.length; i += 1) {
    if (i && i % BATCH === 0) await new Promise((r) => setTimeout(r, BATCH_REST));
    try {
      n += await withUser(ids[i], (u) => (u ? u.contracts.reduce((s, c) => s + freezeDays(c, now, market, upto, inviteOf(u, c, dailyDays)), 0) : 0));
    } catch (e) {
      console.error(`[earnlog] ${ids[i]} failed:`, e.message); // tried again on the next round
      failed.push(ids[i]);
    }
  }
  if (failed.length <= FAILED_MAX) await metaSet(MARK, { day: upto, failed });
  state.scan = null;
  return n;
}

// One round on this server, unless another server is running one.
async function round() {
  await exclusive('earnlog-round', async () => {
    const n = await saveClosedDays();
    if (n) {
      console.log(`[earnlog] saved ${n} miner days`);
      await metaSet('earnlogrun', { at: Date.now(), n });
    }
  });
}

// Called once at boot.
export function startEarnLogTicker() {
  if (globalThis.__vtxEarnLogTimer) return;
  const run = async () => {
    if (state.running) return;
    state.running = true;
    try {
      await round();
    } catch (e) {
      console.error('[earnlog] round failed:', e.message);
    } finally {
      state.running = false;
    }
  };
  globalThis.__vtxEarnLogTimer = jitterEvery(run, EVERY);
  setTimeout(run, Math.round(FIRST * (0.5 + Math.random()))).unref?.();
}
