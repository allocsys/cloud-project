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
    // Warm the key routes before serving, so the first visitor does not pay the cold-start cost
    // of loading them (the page module and its imports - about 1.5s on the first request). The
    // pages have no import-time side effects: they only fetch when rendered. Bounded, and it
    // does not need the database, so it runs even when the database is down.
    try {
      await Promise.race([
        Promise.all([
          import('./app/layout'),
          import('./app/(site)/layout'),
          import('./app/(app)/layout'),
          import('./app/(plain)/layout'),
          import('./app/page'),
          import('./app/(site)/[lang]/about/page'),
          import('./app/(site)/[lang]/faq/page'),
          import('./app/(site)/[lang]/glossary/page'),
          import('./app/(site)/[lang]/how-it-works/page'),
          import('./app/(site)/[lang]/privacy/page'),
          import('./app/(site)/[lang]/refunds/page'),
          import('./app/(site)/[lang]/terms/page'),
          import('./app/status/page'),
          import('./app/(app)/dashboard/page'),
          import('./app/(app)/wallet/page'),
          import('./app/(app)/plans/page'),
          import('./app/(app)/settings/page'),
        ]),
        new Promise((r) => setTimeout(() => r(false), 10_000)),
      ]);
      console.log('[warm] key routes warmed at boot');
    } catch (e) {
      console.error('[warm] boot route warm-up failed:', e.message);
    }
  }
}
