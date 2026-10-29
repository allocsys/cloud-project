// Applies MIGRATIONS in order. An advisory lock makes it safe when several replicas boot at once.
import { db } from './db.js';
import { MIGRATIONS } from './migrations.js';

const LOCK = 7264001;

export async function migrate() {
  const c = await db().connect();
  try {
    await c.query('SELECT pg_advisory_lock($1)', [LOCK]);
    await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await c.query('SELECT id FROM schema_migrations')).rows.map((r) => r.id));
    for (const m of MIGRATIONS) {
      if (done.has(m.id)) continue;
      await c.query('BEGIN');
      try {
        await c.query(m.sql);
        await c.query('INSERT INTO schema_migrations (id) VALUES ($1)', [m.id]);
        await c.query('COMMIT');
        console.log(`[migrate] applied ${m.id}`);
      } catch (e) {
        await c.query('ROLLBACK');
        throw new Error(`migration ${m.id} failed: ${e.message}`);
      }
    }
    // The earlier steps were folded into one baseline: forget their ids.
    await c.query('DELETE FROM schema_migrations WHERE id <> ALL($1::text[])', [MIGRATIONS.map((m) => m.id)]);
  } finally {
    try {
      await c.query('SELECT pg_advisory_unlock($1)', [LOCK]);
    } catch {}
    c.release();
  }
}
