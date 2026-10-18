// Runs once when the server starts, before requests are served.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startPersistence } = await import('./lib/server/persist');
    await startPersistence();
  }
}
