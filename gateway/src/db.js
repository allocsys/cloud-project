// Postgres access for the gateway. Its own database, set by DATABASE_URL (never the app's).
// PGSSL=1 turns TLS on for hosts that need it; Railway's private network does not.
import pg from 'pg';

let pool = null;

export const hasDb = () => !!process.env.DATABASE_URL;

export function db() {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX) || 10,
      ssl: process.env.PGSSL === '1' ? { rejectUnauthorized: false } : undefined,
    });
    pool.on('error', (e) => console.error('[db] idle client error:', e.message));
  }
  return pool;
}

export const q = (text, params) => db().query(text, params);

// Runs fn(client) in one transaction. Throws roll it back.
export async function tx(fn) {
  const c = await db().connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    try {
      await c.query('ROLLBACK');
    } catch {}
    throw e;
  } finally {
    c.release();
  }
}

export async function closeDb() {
  if (pool) {
    const p = pool;
    pool = null;
    await p.end();
  }
}
