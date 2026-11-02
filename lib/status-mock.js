// MOCK FIGURES for the network cards on /status and the dashboard. Staging only: none of these is read from the app,
// except miners: MINERS_BASE (a mock starting figure) plus the real miners running in the database.
// Replace each with a real number (payouts from the database, uptime from the health checks) before launch, and set MINERS_BASE to 0.
export const MINERS_BASE = 217;
export const minersText = (real = 0) => (MINERS_BASE + (Number(real) || 0)).toLocaleString('en-US');
export const NETWORK_MOCK = { paid: '2.47 BTC', last: 'Today, 00:00 UTC', up: '99.98%' };
