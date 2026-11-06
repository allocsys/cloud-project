// Small helpers.
import { timingSafeEqual } from 'node:crypto';

// Constant-time string compare.
export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}
