// Warm the key routes before serving, so the first visitor does not pay the cold-start cost of loading them (the page module and
// its imports - about 1.5s on the first request). The pages have no import-time side effects: they only fetch when rendered.
// Bounded, and it does not need the database. instrumentation.js calls it unless APP_ROLE=api (the API build swaps this file for an empty one).
export async function warmPages() {
  try {
    await Promise.race([
      Promise.all([
        import('./layout'),
        import('./(site)/layout'),
        import('./(app)/layout'),
        import('./(plain)/layout'),
        import('./page'),
        import('./(site)/[lang]/about/page'),
        import('./(site)/[lang]/faq/page'),
        import('./(site)/[lang]/glossary/page'),
        import('./(site)/[lang]/how-it-works/page'),
        import('./(site)/[lang]/privacy/page'),
        import('./(site)/[lang]/refunds/page'),
        import('./(site)/[lang]/terms/page'),
        import('./status/page'),
        import('./(app)/dashboard/page'),
        import('./(app)/wallet/page'),
        import('./(app)/plans/page'),
        import('./(app)/settings/page'),
      ]),
      new Promise((r) => setTimeout(() => r(false), 10_000)),
    ]);
    console.log('[warm] key routes warmed at boot');
  } catch (e) {
    console.error('[warm] boot route warm-up failed:', e.message);
  }
}
