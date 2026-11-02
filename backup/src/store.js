// Backups in KV: <prefix><stamp>:<n> are the parts of the encrypted file, <prefix><stamp>:meta is written LAST,
// so a backup without meta is an unfinished upload and is never used or counted.
// Two series: APP (the app database) and GATEWAY (the gateway database, a separate database on the same server).
import crypto from 'node:crypto';

export const PART = 20 * 1048576; // under the 25 MiB KV value limit
export const APP = 'backup:';
export const GATEWAY = 'gwbackup:';
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

export const stampOf = (d = new Date()) => `${d.toISOString().slice(0, 19).replace(/:/g, '-')}Z`;
const partKey = (prefix, stamp, n) => `${prefix}${stamp}:${n}`;
const metaKey = (prefix, stamp) => `${prefix}${stamp}:meta`;
const stampsOf = (names, prefix) =>
  names
    .filter((n) => n.endsWith(':meta'))
    .map((n) => n.slice(prefix.length, -':meta'.length))
    .sort()
    .reverse();

export async function upload(kv, blob, at = new Date(), partSize = PART, prefix = APP) {
  const stamp = stampOf(at);
  const parts = Math.max(1, Math.ceil(blob.length / partSize));
  for (let i = 0; i < parts; i += 1) await kv.put(partKey(prefix, stamp, i), blob.subarray(i * partSize, (i + 1) * partSize));
  const meta = { stamp, at: at.toISOString(), parts, bytes: blob.length, sha256: sha(blob) };
  await kv.put(metaKey(prefix, stamp), JSON.stringify(meta));
  return meta;
}

// Reads a backup back and checks its size and checksum. stamp = a date from listBackups.
export async function download(kv, stamp, prefix = APP) {
  const raw = await kv.get(metaKey(prefix, stamp));
  if (!raw) throw new Error(`No finished backup ${stamp}.`);
  const meta = JSON.parse(raw.toString('utf8'));
  const chunks = [];
  for (let i = 0; i < meta.parts; i += 1) {
    const b = await kv.get(partKey(prefix, stamp, i));
    if (!b) throw new Error(`Backup ${stamp} is missing part ${i}.`);
    chunks.push(b);
  }
  const blob = Buffer.concat(chunks);
  if (blob.length !== meta.bytes || sha(blob) !== meta.sha256) throw new Error(`Backup ${stamp} does not match its checksum.`);
  return { meta, blob };
}

// Finished backups, newest first.
export async function listBackups(kv, prefix = APP) {
  return stampsOf(await kv.list(prefix), prefix);
}

// Keeps the newest `keep` finished backups and removes every other key of this series (older ones and unfinished uploads).
export async function prune(kv, keep = 14, prefix = APP) {
  const names = await kv.list(prefix);
  const keepSet = new Set(stampsOf(names, prefix).slice(0, Math.max(1, keep)));
  let removed = 0;
  for (const n of names) {
    if (keepSet.has(n.slice(prefix.length).split(':')[0])) continue;
    await kv.del(n);
    removed += 1;
  }
  return removed;
}
