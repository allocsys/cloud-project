// A read-only look at the app's own Postgres for the admin Database tab. Server only.
// Nothing here can change data: every read runs in a READ ONLY transaction with a 5 second limit, table names come from the
// database's own list (never straight from the request), and what a row shows is cut short: JSON columns show only their key names
// and size, columns named like a secret show '(hidden)', other values are cut at 80 characters.
// Never throws: a problem comes back as { ok: false, error } so the tab can show it.
import { pool } from '@/lib/server/db';
import { MIGRATIONS } from '@/lib/server/migrations';

const ROW_LIMIT = 25;
const BIG = 64 * 1048576; // above this a table's row count is the planner's estimate, not a full count
const HIDE = /pass|secret|token|totp|seed|pwd/i;
const ORDER_BY = ['at', 'updated_at', 'created_at', 'day', 'id'];

const quote = (s) => `"${String(s).replace(/"/g, '""')}"`;

async function readOnly(fn) {
  const c = await pool().connect();
  try {
    await c.query('BEGIN READ ONLY');
    await c.query("SET LOCAL statement_timeout = '5s'");
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

const TABLES = `
  SELECT c.relname AS name, pg_total_relation_size(c.oid)::bigint AS bytes, c.reltuples::bigint AS est
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
  ORDER BY c.relname`;

const fail = (e) => ({ ok: false, error: `The database answered with an error: ${String(e?.message || e).slice(0, 160)}` });

export async function databaseOverview() {
  try {
    const t0 = Date.now();
    const out = await readOnly(async (c) => {
      await c.query('SELECT 1');
      const ping = Date.now() - t0;
      const info = (await c.query('SELECT current_database() AS name, version() AS version, pg_database_size(current_database())::bigint AS bytes')).rows[0];
      const max = Number((await c.query('SHOW max_connections')).rows[0].max_connections) || 0;
      const conns = (await c.query('SELECT state, count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() GROUP BY state')).rows;
      const running = (
        await c.query(
          `SELECT state, extract(epoch FROM now() - query_start)::int AS secs, left(regexp_replace(query, '\\s+', ' ', 'g'), 100) AS query
           FROM pg_stat_activity
           WHERE datname = current_database() AND pid <> pg_backend_pid() AND state IS NOT NULL AND state <> 'idle'
           ORDER BY query_start LIMIT 8`,
        )
      ).rows;
      const list = (await c.query(TABLES)).rows;
      const tables = [];
      for (const t of list) {
        const bytes = Number(t.bytes);
        const approx = bytes > BIG;
        const rows = approx ? Math.max(0, Number(t.est)) : (await c.query(`SELECT count(*)::int AS n FROM ${quote(t.name)}`)).rows[0].n;
        tables.push({ name: t.name, rows, approx, bytes });
      }
      let done = [];
      if (list.some((t) => t.name === 'schema_migrations')) done = (await c.query('SELECT id, at FROM schema_migrations ORDER BY id')).rows;
      const doneIds = new Set(done.map((m) => m.id));
      return {
        ping,
        name: info.name,
        version: String(info.version).split(' on ')[0],
        bytes: Number(info.bytes),
        connections: { total: conns.reduce((a, x) => a + x.n, 0), max, active: conns.filter((x) => x.state === 'active').reduce((a, x) => a + x.n, 0) },
        running: running.map((r) => ({ state: r.state, secs: r.secs, query: r.query })),
        tables,
        migrations: {
          applied: done.length,
          total: MIGRATIONS.length,
          pending: MIGRATIONS.filter((m) => !doneIds.has(m.id)).map((m) => m.id),
          list: done.map((m) => ({ id: m.id, at: m.at instanceof Date ? m.at.getTime() : null })),
        },
      };
    });
    const p = pool();
    return { ok: true, ...out, pool: { total: p.totalCount, idle: p.idleCount, waiting: p.waitingCount } };
  } catch (e) {
    return fail(e);
  }
}

// What one column shows: JSON as its key names and size, secret-looking columns hidden, anything else cut short.
function pick(col) {
  const q = quote(col.name);
  if (HIDE.test(col.name)) return `CASE WHEN ${q} IS NULL THEN NULL ELSE '(hidden)' END AS ${q}`;
  if (col.type === 'jsonb' || col.type === 'json') {
    const j = `${q}::jsonb`;
    return `(CASE WHEN jsonb_typeof(${j}) = 'object' THEN (SELECT string_agg(k, ', ' ORDER BY k) FROM (SELECT jsonb_object_keys(${j}) AS k LIMIT 8) s) ELSE jsonb_typeof(${j}) END || ' · ' || pg_column_size(${q})::text || ' B') AS ${q}`;
  }
  return `left(${q}::text, 80) AS ${q}`;
}

// The newest rows of one table (the table must be one the database lists in its public schema).
export async function tableRows(name) {
  const want = typeof name === 'string' ? name : '';
  if (!want || want.length > 80) return { ok: false, error: 'Unknown table.' };
  try {
    return await readOnly(async (c) => {
      const known = (await c.query(TABLES)).rows.map((t) => t.name);
      if (!known.includes(want)) return { ok: false, error: 'Unknown table.' };
      const cols = (await c.query("SELECT column_name AS name, data_type AS type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position", [want])).rows;
      if (!cols.length) return { ok: true, table: want, total: 0, columns: [], rows: [] };
      const order = ORDER_BY.find((k) => cols.some((x) => x.name === k));
      const total = (await c.query(`SELECT count(*)::int AS n FROM ${quote(want)}`)).rows[0].n;
      const r = await c.query(`SELECT ${cols.map(pick).join(', ')} FROM ${quote(want)}${order ? ` ORDER BY ${quote(order)} DESC` : ''} LIMIT ${ROW_LIMIT}`);
      return { ok: true, table: want, total, newest: order || null, limit: ROW_LIMIT, columns: cols.map((x) => x.name), rows: r.rows };
    });
  } catch (e) {
    return fail(e);
  }
}
