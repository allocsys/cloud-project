// One nightly run: for the app database and (when GATEWAY_DB_NAME is set) the gateway database:
// dump, encrypt, upload, read back and check, prune. One failing database does not stop the other.
// Exit code 1 if anything failed (Railway shows the run as failed).
import pg from 'pg';
import { readConfig, withDatabase } from './config.js';
import { dumpDatabase } from './dump.js';
import { encrypt } from './crypt.js';
import { kvClient } from './kv.js';
import { upload, download, prune, APP, GATEWAY } from './store.js';

async function backupOne(label, url, cfg, kv, prefix) {
  const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000 });
  try {
    const dump = await dumpDatabase(pool);
    if (!dump.tables) throw new Error('the database has no tables, nothing saved');
    const meta = await upload(kv, encrypt(dump.buf, cfg.secret), new Date(), undefined, prefix);
    await download(kv, meta.stamp, prefix); // reads it all back and checks size and checksum
    const removed = await prune(kv, cfg.keep, prefix);
    console.log(`[backup] ${label} ok ${meta.stamp}: ${dump.tables} tables, ${dump.rows} rows, ${meta.bytes} bytes, ${meta.parts} part(s), ${removed} old key(s) removed`);
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
  else console.warn('[backup] GATEWAY_DB_NAME is not set: the gateway database is NOT backed up');
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
