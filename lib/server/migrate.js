// Applies the migrations in lib/server/migrations.js once, in order. Safe when several servers boot at the same moment:
// a Postgres advisory lock makes them take turns, and a migration that already ran is skipped.
import { randomBytes } from 'node:crypto';
import { pool, raiseSerialFloor, warm } from '@/lib/server/db';
import { MIGRATIONS } from '@/lib/server/migrations';

const LOCK = 727001;

export async function migrate() {
  const c = await pool().connect();
  let locked = false;
  let broken = false;
  try {
    await c.query('SELECT pg_advisory_lock($1)', [LOCK]);
    locked = true;
    await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await c.query('SELECT id FROM schema_migrations')).rows.map((r) => r.id));
    for (const m of MIGRATIONS) {
      if (done.has(m.id)) continue;
      await c.query('BEGIN');
      try {
        await c.query(m.sql);
        await c.query('INSERT INTO schema_migrations (id) VALUES ($1)', [m.id]);
        await c.query('COMMIT');
        console.log(`[db] applied migration ${m.id}`);
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw new Error(`migration ${m.id} failed: ${e.message}`);
      }
    }
    await raiseSerialFloor(c);
    // Without SESSION_SECRET, every server must still sign sessions with the same key, so it lives in the database.
    await c.query("INSERT INTO meta (key, data) VALUES ('authkey', to_jsonb($1::text)) ON CONFLICT (key) DO NOTHING", [randomBytes(32).toString('hex')]);
  } catch (e) {
    broken = true; // the connection may be in a bad state: it is closed below instead of going back to the pool
    throw e;
  } finally {
    // The lock belongs to the connection, so it must never go back to the pool still holding it: a server booting at the same time would wait for it.
    // If the unlock itself fails, the connection is destroyed, which frees the lock.
    if (locked) {
      try {
        await c.query('SELECT pg_advisory_unlock($1)', [LOCK]);
      } catch {
        broken = true;
      }
    }
    c.release(broken);
  }
  await warm(true);
}

// The database may still be starting when the server boots (docker compose, a redeploy), so try a few times.
export async function migrateWithRetry(tries = 6, waitMs = 2500) {
  for (let i = 1; ; i += 1) {
    try {
      await migrate();
      return true;
    } catch (e) {
      console.error(`[db] not ready (${i}/${tries}): ${e.message}`);
      if (i >= tries) return false;
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}
