// One-time codes for two-factor sign-in (RFC 6238, the kind Google Authenticator, Authy and 1Password make):
// HMAC-SHA1, 30 second steps, 6 digits. No dependencies. Pure, apart from `clock`, which tests can replace.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const STEP_SECONDS = 30;
export const DIGITS = 6;
export const clock = { now: () => Date.now() };

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32(buf) {
  let bits = 0;
  let val = 0;
  let out = '';
  for (const b of buf) {
    val = (val << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(val >>> (bits - 5)) & 31];
      bits -= 5;
    }
    val &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(val << (5 - bits)) & 31];
  return out;
}

// Spaces, dashes and lower case are fine (people copy keys in groups). Anything else is not a key: null.
export function unbase32(text) {
  const s = String(text ?? '').toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  if (!s) return null;
  let bits = 0;
  let val = 0;
  const out = [];
  for (const ch of s) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) return null;
    val = (val << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((val >>> (bits - 8)) & 255);
      bits -= 8;
    }
    val &= (1 << bits) - 1;
  }
  return Buffer.from(out);
}

// A fresh 160-bit secret, as 32 base32 characters.
export const newSecret = () => base32(randomBytes(20));

const hotp = (key, counter) => {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', key).update(msg).digest();
  const o = h[19] & 15;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** DIGITS).padStart(DIGITS, '0');
};

export const stepOf = (ms = clock.now()) => Math.floor(ms / 1000 / STEP_SECONDS);

// The code a correct app shows for this secret during `step`.
export function codeAt(secret, step = stepOf()) {
  const key = unbase32(secret);
  if (!key) throw new Error('Not a valid secret.');
  return hotp(key, step);
}

// Checks what the person typed against the current step and one either side (for clock drift and typing time).
// A step at or before `after` is refused, so a code that was already used cannot be used again.
// Returns the step that matched, or null. Every candidate is compared, in constant time, whatever matches.
export function verify(secret, input, { now = clock.now(), after = 0 } = {}) {
  const typed = String(input ?? '').replace(/\s/g, '');
  const key = unbase32(secret);
  if (!key || !/^\d{6}$/.test(typed)) return null;
  const cur = stepOf(now);
  let hit = null;
  for (const step of [cur - 1, cur, cur + 1]) {
    const a = Buffer.from(hotp(key, step));
    const b = Buffer.from(typed);
    if (timingSafeEqual(a, b) && step > after) hit = hit === null || step > hit ? step : hit;
  }
  return hit;
}

// The link authenticator apps open to add the account (the same data a QR code would carry).
export const otpauthUri = (secret, account, issuer = 'Vertexhash') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;
