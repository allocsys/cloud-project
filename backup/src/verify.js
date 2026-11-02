// Restore rehearsal. Takes the newest finished backup of one series, checks size + checksum, decrypts it, parses it,
// then loads every row into a scratch schema on the same server, all inside ONE transaction that is ALWAYS rolled back.
// Live tables are only read (to copy their shape); nothing is written to them and nothing is left behind.
// Proves: the key opens the file, the file is whole, it matches the live schema, and every row loads.
import { decrypt } from './crypt.js';
import { download, listBackups } from './store.js';
import { parse } from './apply.js';

const quote = (s) => `"${String(s).replace(/"/g, '""')}"`;
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const CHUNK_ROWS = 500;
const SCRATCH = 'vtx_restore_check';

export async function verifyLatest({ kv, pool, secret, prefix }) {
  const stamps = await listBackups(kv, prefix);
  if (!stamps.length) throw new Error('no finished backup to check');
  const { meta, blob } = await download(kv, stamps[0], prefix);
  const { head, lines, total } = parse(decrypt(blob, secret));
  const names = head.tables.map((t) => t.name);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SET LOCAL statement_timeout = '120s'");
    const ids = (await c.query('SELECT id FROM schema_migrations ORDER BY id')).rows.map((x) => x.id);
    const tabs = (
      await c.query(
        `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'schema_migrations'`,
      )
    ).rows.map((x) => x.name);
    const seqs = (await c.query("SELECT sequencename AS name FROM pg_sequences WHERE schemaname = 'public'")).rows.map((x) => x.name);
    if (JSON.stringify(ids) !== JSON.stringify(head.schema) || !same(tabs, names) || !same(seqs, Object.keys(head.sequences))) {
      throw new Error('the backup does not match the live database (different migrations or tables)');
    }
    await c.query(`CREATE SCHEMA ${SCRATCH}`);
    let pos = 1;
    for (const t of head.tables) {
      const live = `"public".${quote(t.name)}`;
      const copy = `${SCRATCH}.${quote(t.name)}`;
      await c.query(`CREATE TABLE ${copy} (LIKE ${live} INCLUDING DEFAULTS)`);
      for (let i = pos; i < pos + t.rows; i += CHUNK_ROWS) {
        const part = lines.slice(i, Math.min(i + CHUNK_ROWS, pos + t.rows));
        await c.query(`INSERT INTO ${copy} SELECT * FROM jsonb_populate_recordset(NULL::${live}, $1::jsonb)`, [`[${part.join(',')}]`]);
      }
      const n = Number((await c.query(`SELECT count(*) AS n FROM ${copy}`)).rows[0].n);
      if (n !== t.rows) throw new Error(`table ${t.name}: ${n} rows loaded, ${t.rows} expected`);
      pos += t.rows;
    }
    return { stamp: meta.stamp, at: head.at, tables: names.length, rows: total };
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    c.release();
  }
}
