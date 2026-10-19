// Runs once when the server starts, before requests are served.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { migrateWithRetry } = await import('./lib/server/migrate');
    if (!(await migrateWithRetry())) console.error('[db] starting without a working database; /api/health will report it.');
  }
}
