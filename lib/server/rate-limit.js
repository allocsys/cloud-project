// Rate limiting utilities for API endpoints and webhooks.
// Uses the existing throttle table for persistence across servers.
// Implements token bucket algorithm for flexible rate limiting.

import { q, pool } from '@/lib/server/db';

const DEFAULT_WINDOW_MS = 60_000; // 1 minute
const DEFAULT_MAX_REQUESTS = 60; // 60 requests per minute

// Rate limit configurations for different endpoints
const RATE_LIMITS = {
  // Webhook endpoints - stricter limits
  webhook: { windowMs: 10_000, maxRequests: 10 }, // 10 requests per 10 seconds
  paymentsWebhook: { windowMs: 5_000, maxRequests: 5 }, // 5 requests per 5 seconds
  
  // Authentication endpoints
  login: { windowMs: 60_000, maxRequests: 5 }, // 5 login attempts per minute
  signup: { windowMs: 3600_000, maxRequests: 3 }, // 3 signups per hour per IP
  resetPassword: { windowMs: 3600_000, maxRequests: 3 }, // 3 reset requests per hour
  
  // API endpoints
  apiDefault: { windowMs: 60_000, maxRequests: 100 }, // 100 requests per minute
  apiStrict: { windowMs: 10_000, maxRequests: 20 }, // 20 requests per 10 seconds
  
  // Admin endpoints
  admin: { windowMs: 60_000, maxRequests: 30 }, // 30 requests per minute
};

/**
 * Check if a key has exceeded its rate limit
 * @param {string} key - Unique identifier (e.g., 'ip:192.168.1.1:login')
 * @param {Object} options - Rate limit options
 * @param {number} options.windowMs - Time window in milliseconds
 * @param {number} options.maxRequests - Maximum requests in window
 * @returns {Promise<{limited: boolean, remaining: number, resetAt: number}>}
 */
export async function checkRateLimit(key, options = {}) {
  const { windowMs = DEFAULT_WINDOW_MS, maxRequests = DEFAULT_MAX_REQUESTS } = options;
  const now = Date.now();
  const windowStart = now - windowMs;
  
  // Get current count from database
  const r = await q(
    `SELECT n, until_ms FROM throttle WHERE key = $1 AND until_ms > $2`,
    [key, windowStart]
  );
  
  const record = r.rows[0];
  const currentCount = record ? record.n : 0;
  const limited = currentCount >= maxRequests;
  const remaining = Math.max(0, maxRequests - currentCount);
  const resetAt = record ? Math.max(now, Number(record.until_ms)) : now + windowMs;
  
  return { limited, remaining, resetAt };
}

/**
 * Increment rate limit counter for a key
 * @param {string} key - Unique identifier
 * @param {Object} options - Rate limit options
 * @returns {Promise<void>}
 */
export async function incrementRateLimit(key, options = {}) {
  const { windowMs = DEFAULT_WINDOW_MS, maxRequests = DEFAULT_MAX_REQUESTS } = options;
  const now = Date.now();
  const windowEnd = now + windowMs;
  
  await q(
    `INSERT INTO throttle (key, n, until_ms) VALUES ($1, 1, $2)
     ON CONFLICT (key) DO UPDATE SET
       n = CASE 
         WHEN throttle.until_ms < $3 THEN 1 
         ELSE throttle.n + 1 
       END,
       until_ms = CASE 
         WHEN throttle.until_ms < $3 THEN $2 
         ELSE throttle.until_ms 
       END`,
    [key, windowEnd, now]
  );
  
  // Periodic cleanup of expired entries (1% chance on each call)
  if (Math.random() < 0.01) {
    await q('DELETE FROM throttle WHERE until_ms < $1', [now]);
  }
}

/**
 * Rate limit middleware for Next.js route handlers
 * @param {Object} options - Rate limit configuration
 * @returns {Function} Middleware function
 */
export function rateLimitMiddleware(options = {}) {
  const { windowMs, maxRequests, keyPrefix = 'api' } = options;
  
  return async function middleware(req) {
    const ip = (req.headers.get('x-forwarded-for') || req.ip || 'unknown').split(',')[0].trim();
    const endpoint = req.nextUrl?.pathname || req.url;
    const key = `${keyPrefix}:${ip}:${endpoint}`;
    
    const result = await checkRateLimit(key, { windowMs, maxRequests });
    
    if (result.limited) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'Too many requests. Please try again later.',
        retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000)
      }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(Math.ceil((result.resetAt - Date.now()) / 1000)),
          'X-RateLimit-Limit': String(maxRequests || DEFAULT_MAX_REQUESTS),
          'X-RateLimit-Remaining': String(result.remaining),
          'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
        }
      });
    }
    
    // Increment counter after successful check
    await incrementRateLimit(key, { windowMs, maxRequests });
    
    return null; // Continue to next middleware/route handler
  };
}

/**
 * Get rate limit configuration by endpoint type
 * @param {string} endpointType - Type of endpoint (e.g., 'webhook', 'login', 'admin')
 * @returns {Object} Rate limit configuration
 */
export function getRateLimitConfig(endpointType) {
  return RATE_LIMITS[endpointType] || RATE_LIMITS.apiDefault;
}

/**
 * Create a rate-limited version of an async function
 * @param {Function} fn - Function to rate limit
 * @param {Object} options - Rate limit options
 * @returns {Function} Rate-limited function
 */
export function rateLimited(fn, options = {}) {
  const { windowMs, maxRequests, getKey } = options;
  
  return async function(...args) {
    const key = getKey ? await getKey(...args) : 'global';
    const result = await checkRateLimit(key, { windowMs, maxRequests });
    
    if (result.limited) {
      throw new Error(`Rate limit exceeded. Retry after ${Math.ceil((result.resetAt - Date.now()) / 1000)} seconds.`);
    }
    
    await incrementRateLimit(key, { windowMs, maxRequests });
    return fn(...args);
  };
}

/**
 * Webhook-specific rate limiting with stricter defaults
 * @param {string} webhookType - Type of webhook (e.g., 'payments', 'nowpayments')
 * @returns {Object} Rate limit middleware config
 */
export function webhookRateLimit(webhookType = 'webhook') {
  return getRateLimitConfig(webhookType || 'webhook');
}

/**
 * Reset rate limit for a specific key (for testing or admin purposes)
 * @param {string} key - Key to reset
 * @returns {Promise<void>}
 */
export async function resetRateLimit(key) {
  await q('DELETE FROM throttle WHERE key = $1', [key]);
}

/**
 * Get rate limit status for a key
 * @param {string} key - Key to check
 * @returns {Promise<Object>} Rate limit status
 */
export async function getRateLimitStatus(key) {
  const r = await q('SELECT n, until_ms FROM throttle WHERE key = $1', [key]);
  const record = r.rows[0];
  
  if (!record) {
    return { count: 0, resetAt: null };
  }
  
  return {
    count: record.n,
    resetAt: Number(record.until_ms)
  };
}

/**
 * Cleanup expired rate limit entries
 * @returns {Promise<number>} Number of entries deleted
 */
export async function cleanupRateLimits() {
  const now = Date.now();
  const r = await q('DELETE FROM throttle WHERE until_ms < $1 RETURNING key', [now]);
  return r.rowCount;
}

export default {
  checkRateLimit,
  incrementRateLimit,
  rateLimitMiddleware,
  getRateLimitConfig,
  rateLimited,
  webhookRateLimit,
  resetRateLimit,
  getRateLimitStatus,
  cleanupRateLimits,
  RATE_LIMITS,
};
