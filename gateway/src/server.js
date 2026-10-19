// Opus gateway entry point. Plain node:http, no framework, so it runs unchanged on any host.
// Config comes only from environment variables. Nothing here imports from the app (app/, lib/, components/).
import { createServer } from 'node:http';
import { hasDb, q, closeDb } from './db.js';
import { migrate } from './migrate.js';
import { json } from './http.js';
import { handleApi } from './api.js';
import { config } from './config.js';
import { CHAINS } from './chains/index.js';
import { btcExplorer } from './explorer.js';
import { startWatcher } from './watcher.js';
import { startOutbox, webhookTarget } from './outbox.js';

const PORT = Number(process.env.PORT) || 4000;

export async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.pathname === '/health') {
    let dbState = 'off';
    if (hasDb()) {
      try {
        await q('SELECT 1');
        dbState = 'ok';
      } catch {
        return json(res, 503, { ok: false, service: 'opus-gateway', db: 'down' });
      }
    }
    return json(res, 200, { ok: true, service: 'opus-gateway', db: dbState });
  }
  if (url.pathname.startsWith('/v1/')) return handleApi(req, res, url);
  return json(res, 404, { ok: false, error: 'Not found.' });
}

const server = createServer((req, res) => {
  handler(req, res).catch((e) => {
    console.error('[gateway] request failed:', e.message);
    if (!res.headersSent) json(res, 500, { ok: false, error: 'Server error.' });
  });
});

async function main() {
  if (hasDb()) await migrate();
  else console.warn('[gateway] DATABASE_URL is not set: running without a database');

  let stopWatcher = async () => {};
  const c = config();
  if (hasDb() && c.watcherEnabled && CHAINS.btc.configured()) {
    // Throws at boot if BTC_EXPLORER_URL is not https: better to refuse to start than to watch nothing.
    const explorers = { btc: btcExplorer({ baseUrl: c.btcExplorerUrl }) };
    stopWatcher = startWatcher({ explorers, intervalMs: c.pollIntervalMs });
    console.log(`[gateway] watching BTC invoices every ${c.pollIntervalMs / 1000}s`);
  } else {
    console.warn('[gateway] payment watcher is NOT running (needs DATABASE_URL, BTC_XPUB, and WATCHER not off)');
  }

  let stopOutbox = async () => {};
  // Throws at boot when APP_WEBHOOK_URL is not https or the secret is too short: better to refuse to start than to send unsigned or exposed callbacks.
  const target = webhookTarget(c);
  if (hasDb() && target) {
    stopOutbox = startOutbox({ target, intervalMs: c.outboxIntervalMs });
    console.log(`[gateway] sending payment callbacks to the app every ${c.outboxIntervalMs / 1000}s`);
  } else {
    console.warn('[gateway] callbacks to the app are NOT being sent (needs DATABASE_URL, APP_WEBHOOK_URL and GATEWAY_WEBHOOK_SECRET)');
  }

  server.listen(PORT, '0.0.0.0', () => console.log(`[gateway] listening on ${PORT}`));
  const stop = () => server.close(async () => {
    await stopWatcher();
    await stopOutbox();
    await closeDb();
    process.exit(0);
  });
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((e) => {
    console.error('[gateway] failed to start:', e.message);
    process.exit(1);
  });
}

export { server };
