// Bitcoin deposit addresses from an extended PUBLIC key. No private key ever reaches this service.
// Give it the account-level key (xpub, or zpub from wallets that export native segwit). Address i is the
// native segwit (bc1q...) address at <account>/0/i, which any wallet built from the same seed can spend.
import { HDKey } from '@scure/bip32';
import { bech32, createBase58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';

const b58c = createBase58check(sha256);

// Public extended key version bytes, and the address prefix each one implies.
const VERSIONS = {
  0x0488b21e: { hrp: 'bc' }, // xpub
  0x04b24746: { hrp: 'bc' }, // zpub
  0x043587cf: { hrp: 'tb' }, // tpub
  0x045f1cf6: { hrp: 'tb' }, // vpub
};
const XPUB = 0x0488b21e;

const bad = (msg) => new Error(msg); // never put the key itself in an error message

// Accepts xpub/zpub/tpub/vpub. Returns the key re-encoded as a plain xpub, and the address prefix.
export function normalizeXpub(key) {
  let raw;
  try {
    raw = b58c.decode(String(key || '').trim());
  } catch {
    throw bad('Not a valid extended public key.');
  }
  if (raw.length !== 78) throw bad('Not a valid extended public key.');
  const view = new DataView(raw.buffer, raw.byteOffset, 4);
  const info = VERSIONS[view.getUint32(0)];
  if (!info) throw bad('Unsupported key type. Give an extended PUBLIC key (xpub or zpub), never a private key.');
  const out = raw.slice();
  new DataView(out.buffer, out.byteOffset, 4).setUint32(0, XPUB);
  const xpub = b58c.encode(out);
  let hd;
  try {
    hd = HDKey.fromExtendedKey(xpub);
  } catch {
    throw bad('Not a valid extended public key.');
  }
  if (hd.privateKey) throw bad('That key holds a private key. Give an extended PUBLIC key only.');
  return { xpub, hrp: info.hrp };
}

// The native segwit address at <account>/0/index.
export function deriveBtcAddress(key, index) {
  if (!Number.isInteger(index) || index < 0 || index >= 0x80000000) throw bad('Invalid address index.');
  const { xpub, hrp } = normalizeXpub(key);
  const child = HDKey.fromExtendedKey(xpub).deriveChild(0).deriveChild(index);
  const program = ripemd160(sha256(child.publicKey));
  return bech32.encode(hrp, [0, ...bech32.toWords(program)]);
}
