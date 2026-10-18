// Postgres persistence. The in-memory store (db.js) stays the working copy so every call stays fast and
// synchronous; this loads it from Postgres on boot and writes changes back every couple of seconds.
// Tables are created automatically, so a fresh database needs no setup.
// Single instance only: two instances would each hold their own copy.
import pg from 'pg';
import { store } from '@/lib/server/db';

const SAVE_MS = 2000;

export async function startPersistence() {
  if (store.mode) return store.mode;
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log('[persist] DATABASE_URL not set: data stays in memory and resets on restart.');
    return (store.mode = 'memory');
  }
  try {
    const pool = new pg.Pool({ connectionString: url, max: 3, connectionTimeoutMillis: 8000 });
    pool.on('error', (e) => console.error('[persist] pool error:', e.message));
    await pool.query(
      'CREATE TABLE IF NOT EXISTS opus_users (id text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())',
    );
    await pool.query('CREATE TABLE IF NOT EXISTS opus_meta (key text PRIMARY KEY, data jsonb NOT NULL)');

    const users = await pool.query('SELECT id, data FROM opus_users');
    users.rows.forEach((r) => store.users.set(r.id, r.data));
    const meta = await pool.query('SELECT key, data FROM opus_meta');
    for (const r of meta.rows) {
      if (r.key === 'serial' && Number.isFinite(r.data)) store.serial = Math.max(store.serial, r.data);
      if (r.key === 'idem' && Array.isArray(r.data)) r.data.forEach(([k, v]) => store.idem.set(k, v));
      if (r.key === 'catalog' && r.data && Array.isArray(r.data.plans) && r.data.halls) store.catalog = r.data;
    }

    const saved = new Map(); // last JSON written per row, so unchanged rows are skipped
    let catalogRow = !!store.catalog; // a saved catalogue row exists, so a reset to defaults must delete it
    let busy = false;
    const flush = async () => {
      if (busy) return;
      busy = true;
      try {
        for (const [id, u] of store.users) {
          const json = JSON.stringify(u);
          if (saved.get(`u:${id}`) === json) continue;
          await pool.query(
            'INSERT INTO opus_users (id, data) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()',
            [id, json],
          );
          saved.set(`u:${id}`, json);
        }
        const rows = { serial: JSON.stringify(store.serial), idem: JSON.stringify([...store.idem]) };
        if (store.catalog) rows.catalog = JSON.stringify(store.catalog);
        else if (catalogRow) {
          await pool.query("DELETE FROM opus_meta WHERE key = 'catalog'");
          catalogRow = false;
          saved.delete('m:catalog');
        }
        for (const [key, json] of Object.entries(rows)) {
          if (saved.get(`m:${key}`) === json) continue;
          await pool.query(
            'INSERT INTO opus_meta (key, data) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data',
            [key, json],
          );
          saved.set(`m:${key}`, json);
          if (key === 'catalog') catalogRow = true;
        }
      } catch (e) {
        console.error('[persist] save failed:', e.message);
      } finally {
        busy = false;
      }
    };
    setInterval(flush, SAVE_MS).unref();
    console.log(`[persist] Postgres connected, ${users.rows.length} user(s) loaded.`);
    return (store.mode = 'postgres');
  } catch (e) {
    console.error('[persist] Postgres unavailable, running in memory:', e.message);
    return (store.mode = 'memory (postgres unavailable)');
  }
}
