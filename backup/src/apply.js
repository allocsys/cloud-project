// Puts a decrypted backup file into a database. Works for the app AND the gateway database.
//   node src/apply.js <file.gz> <postgres-url> RESTORE
// The target must already have the same tables (run the service's migrations on an empty database first).
// Same format and rules as the admin Database tab (lib/server/db-backup.js): one transaction, all or nothing.
import fs from 'node:fs';
import zlib from 'node:zlib';
import pg from 'pg';
import { FORMAT, VERSION } from './dump.js';

const quote = (s) => `"${String(s).replace(/"/g, '""')}"`;
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const CHUNK_ROWS = 500;

export function parse(buf) {
  let text;
  try {
    text = zlib.gunzipSync(buf).toString('utf8');
  } catch {
    throw new Error('This is not a Vertexhash backup file.');
  }
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  let head;
  try {
    head = JSON.parse(lines[0]);
  } catch {
    throw new Error('This is not a Vertexhash backup file.');
  }
  if (!head || head.format !== FORMAT || head.version !== VERSION) throw new Error('This is not a backup this tool can read.');
  const total = head.tables.reduce((a, t) => a + t.rows, 0);
  if (lines.length - 1 !== total) throw new Error('The file is damaged.');
  return { head, lines, total };
}

async function order(c, names) {
  const r = await c.query(
    `SELECT cc.relname AS child, pc.relname AS parent FROM pg_constraint k
     JOIN pg_class cc ON cc.oid = k.conrelid JOIN pg_class pc ON pc.oid = k.confrelid
     WHERE k.contype = 'f' AND cc.relnamespace = 'public'::regnamespace`,
  );
  const parents = new Map(names.map((n) => [n, new Set()]));
  for (const { child, parent } of r.rows) if (child !== parent && parents.has(child) && parents.has(parent)) parents.get(child).add(parent);
  const out = [];
  const left = new Set(names);
  while (left.size) {
    const ready = [...left].filter((n) => [...parents.get(n)].every((p) => !left.has(p)));
    for (const n of ready.length ? ready : [...left]) {
      out.push(n);
      left.delete(n);
    }
  }
  return out;
}

export async function apply(buf, url, confirm) {
  if (confirm !== 'RESTORE') throw new Error('Pass RESTORE as the last argument to confirm.');
  const { head, lines, total } = parse(buf);
  const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000 });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SET LOCAL statement_timeout = '300s'");
    const ids = (await c.query('SELECT id FROM schema_migrations ORDER BY id')).rows.map((x) => x.id);
    const tabs = (
      await c.query(
        `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'schema_migrations'`,
      )
    ).rows.map((x) => x.name);
    const seqs = (await c.query("SELECT sequencename AS name FROM pg_sequences WHERE schemaname = 'public'")).rows.map((x) => x.name);
    const names = head.tables.map((t) => t.name);
    if (JSON.stringify(ids) !== JSON.stringify(head.schema) || !same(tabs, names) || !same(seqs, Object.keys(head.sequences))) {
      throw new Error('The database does not match the backup (different migrations or tables).');
    }
    if (names.length) await c.query(`TRUNCATE ${names.map(quote).join(', ')}`);
    const range = new Map();
    let pos = 1;
    for (const t of head.tables) {
      range.set(t.name, [pos, pos + t.rows]);
      pos += t.rows;
    }
    for (const name of await order(c, names)) {
      const [from, to] = range.get(name);
      for (let i = from; i < to; i += CHUNK_ROWS) {
        const part = lines.slice(i, Math.min(i + CHUNK_ROWS, to));
        await c.query(`INSERT INTO ${quote(name)} SELECT * FROM jsonb_populate_recordset(NULL::${quote(name)}, $1::jsonb)`, [`[${part.join(',')}]`]);
      }
    }
    for (const [name, s] of Object.entries(head.sequences)) {
      await c.query('SELECT setval($1::regclass, $2::bigint, $3::boolean)', [`"public".${quote(name)}`, s.last, s.called]);
    }
    await c.query('COMMIT');
    return { at: head.at, rows: total, tables: names.length };
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
    await pool.end().catch(() => {});
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [file, url, confirm] = process.argv.slice(2);
  if (!file || !url) {
    console.error('Usage: node src/apply.js <file.gz> <postgres-url> RESTORE');
    process.exit(1);
  }
  apply(fs.readFileSync(file), url, confirm).then(
    (r) => console.log(`Restored ${r.rows} rows in ${r.tables} tables (backup from ${r.at}).`),
    (e) => {
      console.error('Restore failed:', String(e?.message || e).slice(0, 300));
      process.exit(1);
    },
  );
}
