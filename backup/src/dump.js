// Whole-database dump in the SAME file format as the admin Database tab (lib/server/db-backup.js, format vtx-backup v1),
// so the decrypted file restores through Admin > Database > Restore. Keep both in step.
// Never log the file or its rows: it holds emails, balances and wallet addresses.
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const gzip = promisify(zlib.gzip);

export const FORMAT = 'vtx-backup';
export const VERSION = 1;
const KEEP = 'schema_migrations';
const quote = (s) => `"${String(s).replace(/"/g, '""')}"`;

// pool: a pg Pool. Reads everything in one consistent, read-only snapshot.
export async function dumpDatabase(pool) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await c.query("SET LOCAL statement_timeout = '120s'");
    const schema = (await c.query('SELECT id FROM schema_migrations ORDER BY id')).rows.map((x) => x.id);
    const names = (
      await c.query(
        `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> $1 ORDER BY c.relname`,
        [KEEP],
      )
    ).rows.map((x) => x.name);
    const tables = [];
    const body = [];
    for (const name of names) {
      const r = await c.query(`SELECT to_jsonb(t)::text AS r FROM ${quote(name)} t`);
      tables.push({ name, rows: r.rows.length });
      for (const row of r.rows) body.push(row.r);
    }
    const sequences = {};
    const seqs = await c.query("SELECT sequencename AS name FROM pg_sequences WHERE schemaname = 'public' ORDER BY sequencename");
    for (const { name } of seqs.rows) {
      const s = (await c.query(`SELECT last_value, is_called FROM ${quote(name)}`)).rows[0];
      sequences[name] = { last: String(s.last_value), called: s.is_called === true };
    }
    await c.query('COMMIT');
    const at = new Date().toISOString();
    const head = JSON.stringify({ format: FORMAT, version: VERSION, at, schema, sequences, tables });
    const buf = await gzip(Buffer.from(`${[head, ...body].join('\n')}\n`, 'utf8'));
    return { buf, at, tables: tables.length, rows: body.length };
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
