// Whole-database backup and restore for the admin Database tab. Server only.
//
// File: gzip of plain text lines. Line 1 is a JSON header (format, version, date, applied migration ids, sequences, and each table's name
// and row count). After it come the rows, table by table in the header's order, one line per row, each exactly as Postgres wrote it
// (to_jsonb text). Rows are never parsed in Node, so big numbers and long decimals come back exactly as they were.
// The migrations table is not part of the file: a backup only restores onto a database with the same migrations and the same tables.
// A restore runs in ONE transaction (TRUNCATE, INSERT, sequences), so any failure leaves the data as it was.
// Never log the file or its rows: it holds emails, balances and wallet addresses.
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { pool, warm } from '@/lib/server/db';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

export const FORMAT = 'vtx-backup';
export const VERSION = 1;
export const MAX_UPLOAD = 100 * 1048576; // the compressed file
const MAX_RAW = 400 * 1048576; // the same file unpacked
const CHUNK_ROWS = 500;
const CHUNK_BYTES = 4 * 1048576;
const KEEP = 'schema_migrations';
const NOT_A_BACKUP = 'This is not a Vertexhash backup file.';
const OTHER_VERSION = 'This backup is from a different database version.';

const quote = (s) => `"${String(s).replace(/"/g, '""')}"`;
const fail = (error) => ({ ok: false, error });
const dbError = (e) => fail(`The database answered with an error: ${String(e?.message || e).slice(0, 160)}`);
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

async function tableNames(c) {
  const r = await c.query(
    `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> $1 ORDER BY c.relname`,
    [KEEP],
  );
  return r.rows.map((x) => x.name);
}

async function sequenceNames(c) {
  const r = await c.query("SELECT sequencename AS name FROM pg_sequences WHERE schemaname = 'public' ORDER BY sequencename");
  return r.rows.map((x) => x.name);
}

async function schemaIds(c) {
  return (await c.query('SELECT id FROM schema_migrations ORDER BY id')).rows.map((x) => x.id);
}

// The whole database as one gzipped file, read in a single consistent snapshot.
export async function makeBackup() {
  const c = await pool().connect();
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await c.query("SET LOCAL statement_timeout = '120s'");
    const schema = await schemaIds(c);
    const tables = [];
    const body = [];
    for (const name of await tableNames(c)) {
      const r = await c.query(`SELECT to_jsonb(t)::text AS r FROM ${quote(name)} t`);
      tables.push({ name, rows: r.rows.length });
      for (const row of r.rows) body.push(row.r);
    }
    const sequences = {};
    for (const name of await sequenceNames(c)) {
      const s = (await c.query(`SELECT last_value, is_called FROM ${quote(name)}`)).rows[0];
      sequences[name] = { last: String(s.last_value), called: s.is_called === true };
    }
    await c.query('COMMIT');
    const at = new Date().toISOString();
    const head = JSON.stringify({ format: FORMAT, version: VERSION, at, schema, sequences, tables });
    const buf = await gzip(Buffer.from(`${[head, ...body].join('\n')}\n`, 'utf8'));
    return { ok: true, buf, at, tables, rows: body.length };
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    return dbError(e);
  } finally {
    c.release();
  }
}

// Unpacks and checks the file itself (not yet against the database).
async function parse(buf) {
  if (!buf || !buf.length) return fail('The file is empty.');
  if (buf.length > MAX_UPLOAD) return fail('The file is too big.');
  let text;
  try {
    text = (await gunzip(buf, { maxOutputLength: MAX_RAW })).toString('utf8');
  } catch {
    return fail(NOT_A_BACKUP);
  }
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  let head;
  try {
    head = JSON.parse(lines[0]);
  } catch {
    return fail(NOT_A_BACKUP);
  }
  if (!head || head.format !== FORMAT) return fail(NOT_A_BACKUP);
  if (head.version !== VERSION) return fail(OTHER_VERSION);
  const tablesOk =
    Array.isArray(head.tables) &&
    head.tables.every((t) => t && typeof t.name === 'string' && Number.isInteger(t.rows) && t.rows >= 0) &&
    new Set(head.tables.map((t) => t.name)).size === head.tables.length;
  const seqOk =
    head.sequences &&
    typeof head.sequences === 'object' &&
    Object.values(head.sequences).every((s) => s && /^-?\d+$/.test(String(s.last)) && typeof s.called === 'boolean');
  if (!tablesOk || !seqOk || !Array.isArray(head.schema) || !head.schema.every((x) => typeof x === 'string') || typeof head.at !== 'string') return fail(NOT_A_BACKUP);
  const total = head.tables.reduce((a, t) => a + t.rows, 0);
  if (lines.length - 1 !== total) return fail('The file is damaged.');
  return { ok: true, head, lines, total };
}

// Does this database match the file: same migrations, same tables, same sequences? Returns an error text or null.
async function mismatch(c, head) {
  if (JSON.stringify(await schemaIds(c)) !== JSON.stringify(head.schema)) return OTHER_VERSION;
  if (!same(await tableNames(c), head.tables.map((t) => t.name))) return OTHER_VERSION;
  if (!same(await sequenceNames(c), Object.keys(head.sequences))) return OTHER_VERSION;
  return null;
}

// Parents before the tables that point at them (foreign keys), so the rows can go in table by table.
async function insertOrder(c, names) {
  const r = await c.query(
    `SELECT cc.relname AS child, pc.relname AS parent
     FROM pg_constraint k JOIN pg_class cc ON cc.oid = k.conrelid JOIN pg_class pc ON pc.oid = k.confrelid
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

async function insertRows(c, name, lines, from, to) {
  let i = from;
  while (i < to) {
    let j = i;
    let bytes = 0;
    while (j < to && j - i < CHUNK_ROWS && bytes < CHUNK_BYTES) {
      bytes += lines[j].length;
      j += 1;
    }
    await c.query(`INSERT INTO ${quote(name)} SELECT * FROM jsonb_populate_recordset(NULL::${quote(name)}, $1::jsonb)`, [`[${lines.slice(i, j).join(',')}]`]);
    i = j;
  }
}

// What is in the file, next to what the database holds now. Changes nothing.
export async function inspectBackup(buf) {
  const p = await parse(buf);
  if (!p.ok) return p;
  try {
    const bad = await mismatch(pool(), p.head);
    if (bad) return fail(bad);
    const tables = [];
    let now = 0;
    for (const t of p.head.tables) {
      const n = (await pool().query(`SELECT count(*)::int AS n FROM ${quote(t.name)}`)).rows[0].n;
      now += n;
      tables.push({ name: t.name, rows: t.rows, now: n });
    }
    return { ok: true, at: p.head.at, rows: p.total, now, tables };
  } catch (e) {
    return dbError(e);
  }
}

// Replaces all data with the file's. confirm must be the word RESTORE. All or nothing.
export async function restoreBackup(buf, confirm) {
  if (confirm !== 'RESTORE') return fail('Type RESTORE to confirm.');
  const p = await parse(buf);
  if (!p.ok) return p;
  const { head, lines } = p;
  const c = await pool().connect();
  try {
    await c.query('BEGIN');
    await c.query("SET LOCAL statement_timeout = '300s'");
    await c.query("SET LOCAL lock_timeout = '30s'");
    const got = (await c.query("SELECT pg_try_advisory_xact_lock(hashtextextended('backup:restore', 0)) AS ok")).rows[0].ok === true;
    if (!got) {
      await c.query('ROLLBACK');
      return fail('A restore is already running.');
    }
    const bad = await mismatch(c, head);
    if (bad) {
      await c.query('ROLLBACK');
      return fail(bad);
    }
    const names = head.tables.map((t) => t.name);
    if (names.length) await c.query(`TRUNCATE ${names.map(quote).join(', ')}`);
    const range = new Map();
    let pos = 1;
    for (const t of head.tables) {
      range.set(t.name, [pos, pos + t.rows]);
      pos += t.rows;
    }
    for (const name of await insertOrder(c, names)) {
      const [from, to] = range.get(name);
      await insertRows(c, name, lines, from, to);
    }
    for (const [name, s] of Object.entries(head.sequences)) {
      await c.query('SELECT setval($1::regclass, $2::bigint, $3::boolean)', [`"public".${quote(name)}`, s.last, s.called]);
    }
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    return dbError(e);
  } finally {
    c.release();
  }
  try {
    await warm(true); // the settings cache follows the restored data at once
  } catch {}
  return { ok: true, at: head.at, rows: p.total, tables: head.tables.length };
}
