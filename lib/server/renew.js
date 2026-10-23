// Renew at term end (Smart Mining). A server timer, like the market ones: every few minutes it looks for Smart Mining miners whose
// `renew` switch is on and whose term is over (the last payout day has closed, lib/server/miners.js renewAt) and buys the next term
// for each (renewSmart). Every step is safe to repeat and safe on several servers: renewSmart locks the account and never renews a miner
// twice, so the timer only has to be roughly on time.
import { q, getUser } from '@/lib/server/db';
import { getMarket } from '@/lib/server/market';
import { renewAt, renewSmart } from '@/lib/server/miners';

const EVERY = 600_000;
const FIRST = 30_000; // after boot, once the other tickers have started
const state = (globalThis.__opusRenew ||= { running: false });

// Renews every due miner and returns how many were bought. A miner skipped for a short balance is not counted (the user is told).
export async function renewDue(now = Date.now()) {
  const ids = (await q(`SELECT id FROM users WHERE data->'contracts' @> '[{"renew": true}]'::jsonb`)).rows.map((r) => r.id);
  if (!ids.length) return 0;
  const market = await getMarket(); // also decides any finished guard days, so the end of a term is final
  let n = 0;
  for (const id of ids) {
    const u = await getUser(id);
    for (const c of u.contracts) {
      if (!c.smart || !c.renew || c.renewedTo || now < renewAt(c, market.guard, now)) continue;
      try {
        if ((await renewSmart(id, c.serial)).renewed) n += 1;
      } catch (e) {
        console.error(`[renew] ${c.serial} failed:`, e.message);
      }
    }
  }
  return n;
}

// Called once at boot.
export function startRenewTicker() {
  if (globalThis.__opusRenewTimer) return;
  const run = async () => {
    if (state.running) return;
    state.running = true;
    try {
      await renewDue();
    } catch (e) {
      console.error('[renew] run failed:', e.message);
    } finally {
      state.running = false;
    }
  };
  globalThis.__opusRenewTimer = setInterval(run, EVERY);
  globalThis.__opusRenewTimer.unref?.();
  setTimeout(run, FIRST).unref?.();
}
