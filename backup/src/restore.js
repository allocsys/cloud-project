// node src/restore.js [gateway] list
// node src/restore.js [gateway] <latest|date> [out.gz]   -> writes the decrypted backup file.
// App file: upload it in Admin > Database > Restore. Gateway file: node src/apply.js (the admin page only handles the app database).
import fs from 'node:fs';
import { readConfig } from './config.js';
import { decrypt } from './crypt.js';
import { kvClient } from './kv.js';
import { download, listBackups, APP, GATEWAY } from './store.js';

export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = [...argv];
  const gateway = args[0] === 'gateway';
  if (gateway) args.shift();
  const prefix = gateway ? GATEWAY : APP;
  const cfg = readConfig(env);
  const kv = kvClient({ account: cfg.account, namespace: cfg.namespace, token: cfg.token });
  const all = await listBackups(kv, prefix);
  const [what = 'list', out] = args;
  if (what === 'list') {
    console.log(all.length ? all.join('\n') : 'No backups found.');
    return;
  }
  const stamp = what === 'latest' ? all[0] : what;
  if (!stamp) throw new Error('No backups found.');
  const { blob } = await download(kv, stamp, prefix);
  const file = out || `vtx-${gateway ? 'gateway-' : ''}backup-${stamp}.gz`;
  fs.writeFileSync(file, decrypt(blob, cfg.secret), { mode: 0o600 });
  console.log(`Saved ${file}.${gateway ? ' Restore it with: node src/apply.js' : ' Upload it in Admin > Database > Restore'}, then delete it.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error('Restore failed:', String(e?.message || e).slice(0, 300));
    process.exit(1);
  });
}
