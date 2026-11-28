// What the API service does at start: migrate the database, start the background jobs, warm the market feeds.
// instrumentation.js calls it unless APP_ROLE=web (the web build swaps this file for an empty one).
export async function startApi() {
  const { migrateWithRetry } = await import('./migrate');
  if (!(await migrateWithRetry())) {
    console.error('[db] starting without a working database; /api/health will report it.');
    return;
  }
  (await import('./market')).startMarketTicker();
  (await import('./smart-market')).startSmartTicker();
  (await import('./renew')).startRenewTicker();
  (await import('./earnlog')).startEarnLogTicker();
  (await import('./botqueue')).startBotQueueTicker();
  (await import('./referrals')).startReferralLockTicker();
  // Warm the external feeds before serving, so the first visitor does not pay the cold-start
  // cascade (CoinGecko, mempool, WhatToMine, Eurostat). Bounded: a slow feed must not hold up startup.
  try {
    const warmed = await Promise.race([
      (await import('./smart-market')).getCoinLive().then((live) => !!live),
      new Promise((r) => setTimeout(() => r(false), 10_000)),
    ]);
    console.log(`[market] feeds warmed at boot: ${warmed ? 'live' : 'timed out, tickers keep trying'}`);
  } catch (e) {
    console.error('[market] boot warm-up failed:', e.message);
  }
}
