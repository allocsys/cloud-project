// Runs once when the server starts, before requests are served.
// APP_ROLE: 'all' (default, everything in one server), 'web' (pages only) or 'api' (database, jobs and /api only).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const role = process.env.APP_ROLE || 'all';
    if (role !== 'web') await (await import('./lib/server/start')).startApi();
    if (role !== 'api') await (await import('./app/warm')).warmPages();
  }
}
