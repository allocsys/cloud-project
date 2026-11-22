// Per-address counters kept in memory (one counter set per server). Used by proxy.js, so this file must stay free of Node-only
// imports. A short window, so it costs nothing per request; the database counters in lib/server/db.js (hit) guard the sign-in routes.

import { edgeAddress } from '@/lib/edge';

const buckets = new Map();

// Counts one request for `key` and says whether it is now over `max` inside the window.
export function over(key, max, windowMs = 60_000, now = Date.now()) {
  let b = buckets.get(key);
  if (!b || b.reset <= now) {
    b = { n: 0, reset: now + windowMs };
    buckets.set(key, b);
  }
  b.n += 1;
  if (buckets.size > 20_000) for (const [k, v] of buckets) if (v.reset <= now) buckets.delete(k);
  return b.n > max;
}

export const clearCounters = () => buckets.clear();

// The caller's address, read from the right of x-forwarded-for (same rule as clientIp in lib/server/auth.js). null = unknown (not limited).
// Fewer entries than hops (a request that skipped a proxy) = the last entry, which the nearest proxy wrote.
export function addressOf(headers, hops = Number(process.env.TRUSTED_PROXIES)) {
  const edge = edgeAddress(headers); // the Worker's own header, trusted only with the edge secret
  if (edge) return edge;
  const n = Math.max(1, Math.floor(hops) || 1);
  const parts = (headers.get('x-forwarded-for') || '').split(',').map((s) => s.trim()).filter(Boolean);
  return parts[parts.length - n] || parts[parts.length - 1] || null;
}

// Plain command-line and scraping tools. Real browsers, link-preview bots and search engines are not in this list.
const TOOLS = /(python-requests|python-urllib|scrapy|curl\/|wget\/|libwww|aiohttp|httpx|go-http-client|headlesschrome|phantomjs|selenium|puppeteer|playwright|mechanize|colly|httrack|nikto|sqlmap|masscan|zgrab|nmap|nuclei|dirbuster|gobuster|ffuf|wpscan)/i;
export const isTool = (ua) => TOOLS.test(ua || '');

// Limits per address per minute. Generous on purpose: many phones share one address behind a mobile network.
export const LIMITS = { page: 300, read: 600, write: 120 };

// Limits per signed-in account per minute (lib/server/auth.js, userId). The dashboard bundle is the heaviest call, so it has its own.
// The shared demo account is not limited here (many visitors use it); the per-address limits above cover it.
export const ACCOUNT_LIMITS = { bundle: 60, read: 300, write: 60 };
