// The admin Database tab. Server only.
// Reading is safe: every read runs in a READ ONLY transaction with a 5 second limit, table names come from the database's own list
// (never straight from the request), and what a row shows is cut short: JSON columns show only their key names and size, columns named
// like a secret show '(hidden)', other values are cut at 80 characters.
// Changing is deliberate and narrow (deleteRow, clearTable, dropTable): one table per call, the table must be one the database lists,
// a row is picked by its primary key, Clear and Drop need the table name typed, schema_migrations is untouchable, and a table the app's
// schema creates (CORE_TABLES) can be emptied but never dropped. Every change is written to the admin log.
// Never throws: a problem comes back as { ok: false, error } so the tab can show it.
import { pool, warm, metaUpdate } from '@/lib/server/db';
import { MIGRATIONS } from '@/lib/server/migrations';

const ROW_LIMIT = 25;
const BIG = 64 * 1048576; // above this a table's row count is the planner's estimate, not a full count
const HIDE = /pass|secret|token|totp|seed|pwd/i;
const ORDER_BY = ['at', 'updated_at', 'created_at', 'day', 'id'];

// The tables 001_init creates. Rows can be removed and the table emptied, but it can never be dropped (the app would break).
export const CORE_TABLES = ['users', 'codes', 'orders', 'withdrawals', 'ledger', 'meta', 'idem', 'throttle', 'market_days', 'hash_samples', 'smart_coins', 'coin_days', 'smart_picks', 'schema_migrations'];
const CORE = new Set(CORE_TABLES);
const LOCKED = new Set(['schema_migrations']); // not even a row of it can be removed

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

// The primary key columns of a table, in key order (empty when it has none).
async function pkOf(c, name) {
  const r = await c.query(
    `SELECT a.attname AS name FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
     WHERE i.indrelid = $1::regclass AND i.indisprimary ORDER BY array_position(i.indkey::int2[], a.attnum)`,
    [`public.${quote(name)}`],
  );
  return r.rows.map((x) => x.name);
}

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
        tables.push({ name: t.name, rows, approx, bytes, core: CORE.has(t.name), locked: LOCKED.has(t.name) });
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
// keys[i] holds the full primary key of rows[i] (what deleteRow needs); canDelete is false when the table has no primary key or is protected.
export async function tableRows(name) {
  const want = typeof name === 'string' ? name : '';
  if (!want || want.length > 80) return { ok: false, error: 'Unknown table.' };
  try {
    return await readOnly(async (c) => {
      const known = (await c.query(TABLES)).rows.map((t) => t.name);
      if (!known.includes(want)) return { ok: false, error: 'Unknown table.' };
      const cols = (await c.query("SELECT column_name AS name, data_type AS type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position", [want])).rows;
      const flags = { core: CORE.has(want), locked: LOCKED.has(want) };
      if (!cols.length) return { ok: true, table: want, total: 0, columns: [], rows: [], keyCols: [], keys: [], canDelete: false, ...flags };
      const order = ORDER_BY.find((k) => cols.some((x) => x.name === k));
      const pk = await pkOf(c, want);
      const total = (await c.query(`SELECT count(*)::int AS n FROM ${quote(want)}`)).rows[0].n;
      const keySel = pk.map((k, i) => `${quote(k)}::text AS ${quote(`__k${i}`)}`);
      const r = await c.query(`SELECT ${[...cols.map(pick), ...keySel].join(', ')} FROM ${quote(want)}${order ? ` ORDER BY ${quote(order)} DESC` : ''} LIMIT ${ROW_LIMIT}`);
      const keys = r.rows.map((row) => {
        const key = {};
        pk.forEach((k, i) => {
          key[k] = row[`__k${i}`];
          delete row[`__k${i}`];
        });
        return key;
      });
      return { ok: true, table: want, total, newest: order || null, limit: ROW_LIMIT, columns: cols.map((x) => x.name), rows: r.rows, keyCols: pk, keys, canDelete: pk.length > 0 && !flags.locked, ...flags };
    });
  } catch (e) {
    return fail(e);
  }
}

// ---- Changes ----

async function writable(fn) {
  const c = await pool().connect();
  try {
    await c.query('BEGIN');
    await c.query("SET LOCAL statement_timeout = '15s'");
    const out = await fn(c);
    if (!out.ok) {
      await c.query('ROLLBACK');
      return out;
    }
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    return fail(e);
  } finally {
    c.release();
  }
}

async function knownTable(c, name) {
  if (typeof name !== 'string' || !name || name.length > 80) return false;
  return (await c.query(TABLES)).rows.some((t) => t.name === name);
}

// After a change: the shared settings cache is read again (a removed meta row must not linger) and the change goes into the admin log.
async function after(action, table, detail) {
  try {
    await warm(true);
    await metaUpdate('adminlog', (cur) => ({ value: [{ at: Date.now(), action, actor: 'admin', subject: table, ...(detail ? { detail } : {}) }, ...(cur || [])].slice(0, 100) }));
  } catch {}
}

// Removes one row, picked by its full primary key ({ column: 'value' } for every key column).
export async function deleteRow(name, key) {
  const r = await writable(async (c) => {
    if (!(await knownTable(c, name))) return { ok: false, error: 'Unknown table.' };
    if (LOCKED.has(name)) return { ok: false, error: 'This table is protected.' };
    const pk = await pkOf(c, name);
    if (!pk.length) return { ok: false, error: 'This table has no row id, so one row cannot be removed. Use Clear.' };
    if (!key || typeof key !== 'object' || pk.some((k) => typeof key[k] !== 'string')) return { ok: false, error: 'Row not found. Refresh.' };
    const where = pk.map((k, i) => `${quote(k)}::text = $${i + 1}`).join(' AND ');
    const d = await c.query(`DELETE FROM ${quote(name)} WHERE ${where}`, pk.map((k) => key[k]));
    if (d.rowCount === 0) return { ok: false, error: 'Row not found. Refresh.' };
    if (d.rowCount > 1) return { ok: false, error: 'More than one row matched. Nothing was removed.' };
    return { ok: true, removed: 1 };
  });
  if (r.ok) await after('db-row-delete', name);
  return r;
}

// Removes every row of a table. The table name must be typed as the confirmation.
export async function clearTable(name, confirm) {
  const r = await writable(async (c) => {
    if (!(await knownTable(c, name))) return { ok: false, error: 'Unknown table.' };
    if (LOCKED.has(name)) return { ok: false, error: 'This table is protected.' };
    if (confirm !== name) return { ok: false, error: 'Type the table name to confirm.' };
    const d = await c.query(`DELETE FROM ${quote(name)}`);
    return { ok: true, removed: d.rowCount };
  });
  if (r.ok) await after('db-clear', name, `${r.removed} rows`);
  return r;
}

// Drops a table the app does not use (one 001_init does not create). The table name must be typed as the confirmation.
export async function dropTable(name, confirm) {
  const r = await writable(async (c) => {
    if (!(await knownTable(c, name))) return { ok: false, error: 'Unknown table.' };
    if (CORE.has(name)) return { ok: false, error: 'The app uses this table, so it cannot be dropped. Use Clear.' };
    if (confirm !== name) return { ok: false, error: 'Type the table name to confirm.' };
    await c.query(`DROP TABLE ${quote(name)}`);
    return { ok: true };
  });
  if (r.ok) await after('db-drop', name);
  return r;
}
