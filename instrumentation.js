// Runs once when the server starts, before requests are served.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { migrateWithRetry } = await import('./lib/server/migrate');
    if (!(await migrateWithRetry())) console.error('[db] starting without a working database; /api/health will report it.');
    else {
      (await import('./lib/server/market')).startMarketTicker();
      (await import('./lib/server/smart-market')).startSmartTicker();
      (await import('./lib/server/renew')).startRenewTicker();
      (await import('./lib/server/referrals')).startReferralLockTicker();
      // Warm the external feeds before serving, so the first visitor does not pay the cold-start
      // cascade (CoinGecko, mempool, WhatToMine, Eurostat). Bounded: a slow feed must not hold up startup.
      try {
        const warmed = await Promise.race([
          (await import('./lib/server/smart-market')).getCoinLive().then((live) => !!live),
          new Promise((r) => setTimeout(() => r(false), 10_000)),
        ]);
        console.log(`[market] feeds warmed at boot: ${warmed ? 'live' : 'timed out, tickers keep trying'}`);
      } catch (e) {
        console.error('[market] boot warm-up failed:', e.message);
      }
    }
  }
}
