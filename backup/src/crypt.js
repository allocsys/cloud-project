// AES-256-GCM with a key derived from BACKUP_KEY (scrypt, random salt per file).
// File: "VTXB1" | salt 16 | iv 12 | ciphertext | auth tag 16. A wrong key or a changed byte fails the tag check.
import crypto from 'node:crypto';

const MAGIC = Buffer.from('VTXB1');
const SALT = 16;
const IV = 12;
const TAG = 16;

export function checkSecret(secret) {
  if (typeof secret !== 'string' || secret.length < 24) throw new Error('BACKUP_KEY must be at least 24 characters.');
}

export function encrypt(buf, secret) {
  checkSecret(secret);
  const salt = crypto.randomBytes(SALT);
  const iv = crypto.randomBytes(IV);
  const c = crypto.createCipheriv('aes-256-gcm', crypto.scryptSync(secret, salt, 32), iv);
  const body = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, body, c.getAuthTag()]);
}

export function decrypt(blob, secret) {
  checkSecret(secret);
  if (!Buffer.isBuffer(blob) || blob.length < MAGIC.length + SALT + IV + TAG || !blob.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('This is not an encrypted Vertexhash backup.');
  }
  let o = MAGIC.length;
  const salt = blob.subarray(o, (o += SALT));
  const iv = blob.subarray(o, (o += IV));
  const tag = blob.subarray(blob.length - TAG);
  const body = blob.subarray(o, blob.length - TAG);
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', crypto.scryptSync(secret, salt, 32), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(body), d.final()]);
  } catch {
    throw new Error('Wrong key, or the file is damaged.');
  }
}
