// Renew at term end (Smart Mining). A server timer, like the market ones: every few minutes it looks for Smart Mining miners whose
// `renew` switch is on and whose term is over (the last payout day has closed, lib/server/miners.js renewAt) and buys the next term
// for each (renewSmart). Every step is safe to repeat and safe on several servers: renewSmart locks the account and never renews a miner
// twice. Only one server runs a round at a time (a job lock) and a round that another server finished a moment ago is skipped, so the
// timer only has to be roughly on time. The accounts to look at come from a partial index (migration 012), not a scan of every account.
import { q, metaSet, hydrate, exclusive } from '@/lib/server/db';
import { getMarket } from '@/lib/server/market';
import { renewAt, renewSmart } from '@/lib/server/miners';
import { settleDue } from '@/lib/server/boost';

const EVERY = 600_000;
const SLACK = 60_000; // a round this close to the last one (on any server) is skipped
const FIRST = 30_000; // after boot, once the other tickers have started
const state = (globalThis.__opusRenew ||= { running: false });

// Renews every due miner and returns how many were bought. A miner skipped for a short balance is not counted (the user is told).
export async function renewDue(now = Date.now()) {
  // The condition is the one of the partial index users_renew_idx, so only accounts with a renewing miner are read, in one query.
  const rows = (await q(`SELECT id, data FROM users WHERE data->'contracts' @> '[{"renew": true}]'::jsonb`)).rows;
  if (!rows.length) return 0;
  const market = await getMarket(); // also decides any finished guard days, so the end of a term is final
  let n = 0;
  for (const row of rows) {
    const u = hydrate(row.id, row.data);
    for (const c of u.contracts) {
      if (!c.smart || !c.renew || c.renewedTo || now < renewAt(c, market.guard, now)) continue;
      try {
        if ((await renewSmart(u.id, c.serial)).renewed) n += 1;
      } catch (e) {
        console.error(`[renew] ${c.serial} failed:`, e.message);
      }
    }
  }
  return n;
}

// One round on this server, unless another server is running one or has just finished one.
async function round() {
  await exclusive('renew-round', async () => {
    const last = Number((await q("SELECT data FROM meta WHERE key = 'renewrun'")).rows[0]?.data?.at) || 0;
    if (Date.now() - last < EVERY - SLACK) return;
    await metaSet('renewrun', { at: Date.now() });
    try {
      await renewDue();
    } catch (e) {
      console.error('[renew] run failed:', e.message);
    }
    try {
      await settleDue(); // finished boost tickets (lib/server/boost.js)
    } catch (e) {
      console.error('[boost] settle failed:', e.message);
    }
  });
}

// Called once at boot.
export function startRenewTicker() {
  if (globalThis.__opusRenewTimer) return;
  const run = async () => {
    if (state.running) return;
    state.running = true;
    try {
      await round();
    } catch (e) {
      console.error('[renew] round failed:', e.message);
    } finally {
      state.running = false;
    }
  };
  globalThis.__opusRenewTimer = setInterval(run, EVERY);
  globalThis.__opusRenewTimer.unref?.();
  setTimeout(run, FIRST).unref?.();
}
