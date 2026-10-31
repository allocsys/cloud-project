// Withdrawal address checks with checksums: a mistyped address is caught before any money is reserved.
// Plain JS with no node: imports, so the browser and the server run the same code (hashes are written out here).
// Networks: btc (bech32 v0, bech32m v1, legacy 1... and 3...), erc20 and bep20 (EIP-55 when the case is mixed), trc20, ton.

const M64 = (1n << 64n) - 1n;
const rotl = (v, n) => (n === 0 ? v : ((v << BigInt(n)) | (v >> BigInt(64 - n))) & M64);

// Keccak-f[1600] constants, generated the way the spec describes them (no tables to mistype).
const RC = [];
for (let ir = 0; ir < 24; ir += 1) {
  let rc = 0n;
  for (let j = 0; j < 7; j += 1) {
    let R = 1;
    for (let i = 0; i < (j + 7 * ir) % 255; i += 1) {
      R <<= 1;
      if (R & 0x100) R ^= 0x171;
    }
    if (R & 1) rc |= 1n << BigInt(2 ** j - 1);
  }
  RC.push(rc);
}
const ROT = new Array(25).fill(0);
{
  let x = 1;
  let y = 0;
  for (let t = 0; t < 24; t += 1) {
    ROT[x + 5 * y] = (((t + 1) * (t + 2)) / 2) % 64;
    [x, y] = [y, (2 * x + 3 * y) % 5];
  }
}

function keccakF(s) {
  for (let ir = 0; ir < 24; ir += 1) {
    const C = [];
    for (let x = 0; x < 5; x += 1) C[x] = s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20];
    for (let x = 0; x < 5; x += 1) {
      const D = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
      for (let y = 0; y < 5; y += 1) s[x + 5 * y] ^= D;
    }
    const B = new Array(25);
    for (let x = 0; x < 5; x += 1) for (let y = 0; y < 5; y += 1) B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(s[x + 5 * y], ROT[x + 5 * y]);
    for (let x = 0; x < 5; x += 1) for (let y = 0; y < 5; y += 1) s[x + 5 * y] = B[x + 5 * y] ^ (~B[((x + 1) % 5) + 5 * y] & M64 & B[((x + 2) % 5) + 5 * y]);
    s[0] ^= RC[ir];
  }
}

// Keccak-256 (the original padding Ethereum uses, not the SHA-3 one). Input and output are Uint8Array.
export function keccak256(bytes) {
  const rate = 136;
  const blocks = Math.floor(bytes.length / rate) + 1;
  const p = new Uint8Array(blocks * rate);
  p.set(bytes);
  p[bytes.length] ^= 0x01;
  p[blocks * rate - 1] ^= 0x80;
  const s = new Array(25).fill(0n);
  for (let off = 0; off < p.length; off += rate) {
    for (let i = 0; i < rate / 8; i += 1) {
      let v = 0n;
      for (let b = 7; b >= 0; b -= 1) v = (v << 8n) | BigInt(p[off + 8 * i + b]);
      s[i] ^= v;
    }
    keccakF(s);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i += 1) {
    let v = s[i];
    for (let b = 0; b < 8; b += 1) {
      out[8 * i + b] = Number(v & 0xffn);
      v >>= 8n;
    }
  }
  return out;
}

// SHA-256, constants from the first primes as the spec defines them.
const PRIMES = [];
for (let n = 2; PRIMES.length < 64; n += 1) if (PRIMES.every((p) => n % p)) PRIMES.push(n);
const frac32 = (v) => Math.floor((v - Math.floor(v)) * 2 ** 32) >>> 0;
const K256 = PRIMES.map((p) => frac32(Math.cbrt(p)));
const H256 = PRIMES.slice(0, 8).map((p) => frac32(Math.sqrt(p)));
const rotr = (x, n) => (x >>> n) | (x << (32 - n));

export function sha256(msg) {
  const H = H256.slice();
  const len = msg.length;
  const p = new Uint8Array(((len + 9 + 63) >> 6) << 6);
  p.set(msg);
  p[len] = 0x80;
  const dv = new DataView(p.buffer);
  dv.setUint32(p.length - 8, Math.floor((len * 8) / 2 ** 32));
  dv.setUint32(p.length - 4, (len * 8) >>> 0);
  const w = new Array(64);
  for (let off = 0; off < p.length; off += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = dv.getUint32(off + 4 * i);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i += 1) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, h].forEach((v, i) => {
      H[i] = (H[i] + v) >>> 0;
    });
  }
  const out = new Uint8Array(32);
  const od = new DataView(out.buffer);
  H.forEach((v, i) => od.setUint32(4 * i, v));
  return out;
}

const ascii = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));

// EVM: all lower or all upper case has no checksum and is accepted; mixed case must match EIP-55.
function evmOk(a) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(a)) return false;
  const h = a.slice(2);
  if (h === h.toLowerCase() || h === h.toUpperCase()) return true;
  const hash = keccak256(ascii(h.toLowerCase()));
  for (let i = 0; i < 40; i += 1) {
    const c = h[i];
    if (c.toLowerCase() === c.toUpperCase()) continue; // a digit
    const nibble = (hash[i >> 1] >> (i % 2 === 0 ? 4 : 0)) & 15;
    if ((c === c.toUpperCase()) !== nibble >= 8) return false;
  }
  return true;
}

// Base58Check: the payload without its 4 checksum bytes, or null.
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58check(s) {
  let n = 0n;
  for (const ch of s) {
    const i = B58.indexOf(ch);
    if (i < 0) return null;
    n = n * 58n + BigInt(i);
  }
  const rest = [];
  while (n > 0n) {
    rest.push(Number(n & 255n));
    n >>= 8n;
  }
  let zeros = 0;
  while (zeros < s.length && s[zeros] === '1') zeros += 1;
  const bytes = Uint8Array.from([...new Array(zeros).fill(0), ...rest.reverse()]);
  if (bytes.length < 5) return null;
  const body = bytes.slice(0, -4);
  const sum = sha256(sha256(body));
  for (let i = 0; i < 4; i += 1) if (sum[i] !== bytes[bytes.length - 4 + i]) return null;
  return body;
}

// Bech32 (BIP 173) and bech32m (BIP 350), for bc1 addresses: witness version 0 (20 or 32 bytes) and 1 (32 bytes).
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khe6mua7l';
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
function polymod(values) {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i += 1) if ((top >> i) & 1) chk ^= GEN[i];
  }
  return chk >>> 0;
}
function from5bits(vals) {
  let acc = 0;
  let bits = 0;
  const out = [];
  for (const v of vals) {
    acc = ((acc << 5) | v) & 0xfff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 255);
    }
  }
  if (bits >= 5 || ((acc << (8 - bits)) & 255)) return null;
  return out;
}
function bech32Ok(a) {
  if (a !== a.toLowerCase() && a !== a.toUpperCase()) return false;
  const s = a.toLowerCase();
  if (s.length < 14 || s.length > 90 || !s.startsWith('bc1')) return false;
  const data = [];
  for (const ch of s.slice(3)) {
    const i = CHARSET.indexOf(ch);
    if (i < 0) return false;
    data.push(i);
  }
  if (data.length < 7) return false;
  const ver = data[0];
  const chk = polymod([3, 3, 0, 2, 3, ...data]); // 3,3,0,2,3 is the human part "bc" expanded
  if (chk !== (ver === 0 ? 1 : 0x2bc830a3)) return false;
  const prog = from5bits(data.slice(1, -6));
  if (!prog) return false;
  if (ver === 0) return prog.length === 20 || prog.length === 32;
  return ver === 1 && prog.length === 32;
}

function btcOk(a) {
  if (/^bc1/i.test(a)) return bech32Ok(a);
  const body = base58check(a);
  return !!body && body.length === 21 && (body[0] === 0x00 || body[0] === 0x05);
}

function tronOk(a) {
  const body = /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a) ? base58check(a) : null;
  return !!body && body.length === 21 && body[0] === 0x41;
}

// TON user-friendly address: 36 bytes (tag, workchain, 32 byte hash, CRC16 of the first 34) in base64url. Basechain only.
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function crc16(bytes) {
  let c = 0;
  for (const x of bytes) {
    c ^= x << 8;
    for (let i = 0; i < 8; i += 1) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
  }
  return c;
}
function tonOk(a) {
  if (!/^[A-Za-z0-9_-]{48}$/.test(a)) return false;
  const b = [];
  for (let i = 0; i < 48; i += 4) {
    const n = (B64URL.indexOf(a[i]) << 18) | (B64URL.indexOf(a[i + 1]) << 12) | (B64URL.indexOf(a[i + 2]) << 6) | B64URL.indexOf(a[i + 3]);
    b.push((n >> 16) & 255, (n >> 8) & 255, n & 255);
  }
  if ((b[0] !== 0x11 && b[0] !== 0x51) || b[1] !== 0) return false;
  return crc16(b.slice(0, 34)) === ((b[34] << 8) | b[35]);
}

// True when `a` is a well-formed address with a correct checksum on network `net` (an id from NETWORKS in lib/assets.js).
export function checkAddress(net, a) {
  if (typeof a !== 'string') return false;
  if (net === 'btc') return btcOk(a);
  if (net === 'erc20' || net === 'bep20') return evmOk(a);
  if (net === 'trc20') return tronOk(a);
  if (net === 'ton') return tonOk(a);
  return false;
}
