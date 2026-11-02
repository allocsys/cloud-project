// One nightly run: for the app database and (when GATEWAY_DB_NAME is set) the gateway database:
// dump, encrypt, upload, read back and check, prune. One failing database does not stop the other.
// Exit code 1 if anything failed (Railway shows the run as failed).
import pg from 'pg';
import { readConfig, withDatabase } from './config.js';
import { dumpDatabase } from './dump.js';
import { encrypt } from './crypt.js';
import { kvClient } from './kv.js';
import { upload, download, prune, APP, GATEWAY } from './store.js';
import { verifyLatest } from './verify.js';

// Restore rehearsal on the backup just written; the result (no data, only counts) goes to KV key restoretest:<label>
// for the Worker dashboard. A failed check makes the run fail, but the backup itself is already saved.
async function checkRestore(label, pool, cfg, kv, prefix) {
  const key = `restoretest:${label}`;
  try {
    const r = await verifyLatest({ kv, pool, secret: cfg.secret, prefix });
    await kv.put(key, JSON.stringify({ ok: true, at: new Date().toISOString(), backup: r.stamp, tables: r.tables, rows: r.rows }));
    console.log(`[backup] ${label} restore check ok: ${r.tables} tables, ${r.rows} rows loaded into a scratch schema and rolled back`);
  } catch (e) {
    const error = String(e?.message || e).slice(0, 200);
    await kv.put(key, JSON.stringify({ ok: false, at: new Date().toISOString(), error })).catch(() => {});
    throw new Error(`restore check failed: ${error}`);
  }
}

async function backupOne(label, url, cfg, kv, prefix) {
  const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000 });
  try {
    const dump = await dumpDatabase(pool);
    if (!dump.tables) throw new Error('the database has no tables, nothing saved');
    const meta = await upload(kv, encrypt(dump.buf, cfg.secret), new Date(), undefined, prefix);
    await download(kv, meta.stamp, prefix); // reads it all back and checks size and checksum
    const removed = await prune(kv, cfg.keep, prefix);
    console.log(`[backup] ${label} ok ${meta.stamp}: ${dump.tables} tables, ${dump.rows} rows, ${meta.bytes} bytes, ${meta.parts} part(s), ${removed} old key(s) removed`);
    await checkRestore(label, pool, cfg, kv, prefix);
  } finally {
    await pool.end().catch(() => {});
  }
}

// Names only, no secrets: helps to find the value for GATEWAY_DB_NAME.
async function logDatabaseNames(url) {
  const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000 });
  try {
    const r = await pool.query('SELECT datname FROM pg_database WHERE NOT datistemplate ORDER BY datname');
    console.warn(`[backup] databases on this server: ${r.rows.map((x) => x.datname).join(', ')}`);
  } catch (e) {
    console.warn('[backup] could not list databases:', String(e?.message || e).slice(0, 120));
  } finally {
    await pool.end().catch(() => {});
  }
}

export async function main(env = process.env) {
  const cfg = readConfig(env);
  if (!cfg.dbUrl) throw new Error('Missing variables: DATABASE_URL');
  const kv = kvClient({ account: cfg.account, namespace: cfg.namespace, token: cfg.token });
  const jobs = [['app', cfg.dbUrl, APP]];
  if (cfg.gatewayDb) jobs.push(['gateway', withDatabase(cfg.dbUrl, cfg.gatewayDb), GATEWAY]);
  else {
    console.warn('[backup] GATEWAY_DB_NAME is not set: the gateway database is NOT backed up');
    await logDatabaseNames(cfg.dbUrl);
  }
  const failed = [];
  for (const [label, url, prefix] of jobs) {
    try {
      await backupOne(label, url, cfg, kv, prefix);
    } catch (e) {
      failed.push(label);
      console.error(`[backup] ${label} FAILED:`, String(e?.message || e).slice(0, 300));
    }
  }
  if (failed.length) throw new Error(`failed: ${failed.join(', ')}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(
    () => process.exit(0),
    (e) => {
      console.error('[backup] FAILED:', String(e?.message || e).slice(0, 300));
      process.exit(1);
    },
  );
}
