// Vertexhash Telegram bot entry point. Plain node:http. Nothing here imports from the app.
import { createServer } from 'node:http';
import { hasDb, q, closeDb } from './db.js';
import { migrate } from './migrate.js';
import { ensureDatabase } from './ensure-db.js';
import { provisionRole } from './provision-role.js';
import { json } from './http.js';
import { config, checkConfig } from './config.js';
import { telegram } from './telegram.js';
import { makeBot } from './app.js';
import { makeQueue } from './queue.js';

const PORT = Number(process.env.PORT) || 4000;

// Points Telegram at this service and sets the command menu. Safe to repeat on every boot and every replica.
async function setup(tg, c) {
  if (!c.publicHost) {
    console.warn('[bot] no public host (BOT_PUBLIC_HOST or RAILWAY_PUBLIC_DOMAIN): the Telegram webhook was NOT set');
    return;
  }
  const w = await tg.call('setWebhook', {
    url: `https://${c.publicHost}/tg/${c.path}`,
    secret_token: c.secret,
    allowed_updates: ['message', 'my_chat_member', 'callback_query'],
    max_connections: 40,
  });
  console.log(w.ok ? '[bot] webhook set' : `[bot] webhook NOT set: ${w.description || w.status}`);
  // The buttons replace the slash list: clear it (typed commands still work).
  const m = await tg.call('deleteMyCommands');
  console.log(m.ok ? '[bot] command list cleared' : `[bot] command list NOT cleared: ${m.description || m.status}`);
}

async function main() {
  const c = config();
  checkConfig(c);
  if (!hasDb()) throw new Error('DATABASE_URL is required');
  // One-time setup: own database and a limited login (see README). Afterwards DATABASE_URL points at the limited login.
  if (process.env.BOT_DB_NAME) {
    const adminUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = await ensureDatabase(adminUrl, process.env.BOT_DB_NAME);
    if (process.env.BOT_DB_USER) {
      process.env.DATABASE_URL = await provisionRole(adminUrl, {
        db: process.env.BOT_DB_NAME,
        role: process.env.BOT_DB_USER,
        password: process.env.BOT_DB_PASSWORD,
      });
      console.log(`[bot] running as limited login ${process.env.BOT_DB_USER}`);
    }
  }
  await migrate();

  const tg = telegram(c.token);
  const queue = makeQueue({ tg, config: c });
  const bot = makeBot({ config: c, tg, queue });
  const server = createServer((req, res) => {
    bot.handler(req, res).catch((e) => {
      console.error('[bot] request failed:', e.message);
      if (!res.headersSent) json(res, 500, { ok: false, error: 'Server error.' });
    });
  });
  const clean = setInterval(() => {
    q("DELETE FROM processed_updates WHERE at < now() - interval '2 days'").catch((e) => console.error('[bot] cleanup failed:', e.message));
  }, 3_600_000);
  clean.unref();

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[bot] listening on ${PORT}`);
    setup(tg, c).catch((e) => console.error('[bot] setup failed:', e.message));
    if (c.notifySecret) queue.start();
  });
  const stop = () =>
    server.close(async () => {
      clearInterval(clean);
      await queue.stop();
      await bot.idle();
      await closeDb();
      process.exit(0);
    });
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((e) => {
  console.error('[bot] failed to start:', e.message);
  process.exit(1);
});
