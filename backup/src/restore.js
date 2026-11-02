// node src/restore.js list
// node src/restore.js <latest|date> [out.gz]   -> writes the decrypted backup file; upload it in Admin > Database > Restore.
import fs from 'node:fs';
import { readConfig } from './config.js';
import { decrypt } from './crypt.js';
import { kvClient } from './kv.js';
import { download, listBackups } from './store.js';

export async function main(argv = process.argv.slice(2), env = process.env) {
  const cfg = readConfig(env);
  const kv = kvClient({ account: cfg.account, namespace: cfg.namespace, token: cfg.token });
  const all = await listBackups(kv);
  const [what = 'list', out] = argv;
  if (what === 'list') {
    console.log(all.length ? all.join('\n') : 'No backups found.');
    return;
  }
  const stamp = what === 'latest' ? all[0] : what;
  if (!stamp) throw new Error('No backups found.');
  const { blob } = await download(kv, stamp);
  const file = out || `vtx-backup-${stamp}.gz`;
  fs.writeFileSync(file, decrypt(blob, cfg.secret), { mode: 0o600 });
  console.log(`Saved ${file}. Upload it in Admin > Database > Restore, then delete it.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error('Restore failed:', String(e?.message || e).slice(0, 300));
    process.exit(1);
  });
}
