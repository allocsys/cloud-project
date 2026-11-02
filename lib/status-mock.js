// MOCK FIGURES for the network cards on /status and the landing strip (components/NetworkLive.js). Staging only: none of these is
// read from the app, except miners: MINERS_BASE (a mock starting figure) plus the real miners running in the database.
// Replace each with a real number (payouts from the database, uptime from the health checks) before launch, and set MINERS_BASE to 0.
export const MINERS_BASE = 217;
export const PAID_BTC = 2.47;
export const UPTIME_PCT = 99.98;
export const minersCount = (real = 0) => MINERS_BASE + (Number(real) || 0);
export const minersText = (real = 0) => minersCount(real).toLocaleString('en-US');
export const NETWORK_MOCK = { paid: `${PAID_BTC.toFixed(2)} BTC`, last: 'Today, 00:00 UTC', up: `${UPTIME_PCT.toFixed(2)}%` };
