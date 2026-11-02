// One nightly run: dump, encrypt, upload, read back and check, prune. Exit code 1 on any failure (Railway shows the run as failed).
import pg from 'pg';
import { readConfig } from './config.js';
import { dumpDatabase } from './dump.js';
import { encrypt } from './crypt.js';
import { kvClient } from './kv.js';
import { upload, download, prune } from './store.js';

export async function main(env = process.env) {
  const cfg = readConfig(env);
  if (!cfg.dbUrl) throw new Error('Missing variables: DATABASE_URL');
  const pool = new pg.Pool({ connectionString: cfg.dbUrl, max: 1, connectionTimeoutMillis: 10_000 });
  try {
    const dump = await dumpDatabase(pool);
    if (!dump.tables) throw new Error('The database has no tables, nothing saved.');
    const kv = kvClient({ account: cfg.account, namespace: cfg.namespace, token: cfg.token });
    const meta = await upload(kv, encrypt(dump.buf, cfg.secret));
    await download(kv, meta.stamp); // reads it all back and checks size and checksum
    const removed = await prune(kv, cfg.keep);
    console.log(`[backup] ok ${meta.stamp}: ${dump.tables} tables, ${dump.rows} rows, ${meta.bytes} bytes, ${meta.parts} part(s), ${removed} old key(s) removed`);
  } finally {
    await pool.end().catch(() => {});
  }
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
