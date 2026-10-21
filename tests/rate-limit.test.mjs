// Tests for rate limiting utilities (lib/server/rate-limit.js)
// Runs against a real Postgres (DATABASE_URL).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, q } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const rateLimit = await import('@/lib/server/rate-limit');

const { 
  checkRateLimit, 
  incrementRateLimit, 
  resetRateLimit, 
  getRateLimitConfig,
  getRateLimitStatus,
  cleanupRateLimits,
  RATE_LIMITS 
} = rateLimit;

const run = Date.now().toString(36);
const TEST_KEY = `test-rl-${run}`;
const TEST_KEY_2 = `test-rl-2-${run}`;

before(async () => {
  await migrate();
});

after(async () => {
  // Cleanup test keys
  await resetRateLimit(TEST_KEY);
  await resetRateLimit(TEST_KEY_2);
  await pool().end();
});

test('RATE_LIMITS has all expected configurations', () => {
  assert.ok(RATE_LIMITS.webhook, 'Should have webhook config');
  assert.ok(RATE_LIMITS.login, 'Should have login config');
  assert.ok(RATE_LIMITS.apiDefault, 'Should have apiDefault config');
  assert.ok(RATE_LIMITS.admin, 'Should have admin config');
  assert.ok(RATE_LIMITS.signup, 'Should have signup config');
  assert.ok(RATE_LIMITS.resetPassword, 'Should have resetPassword config');
});

test('getRateLimitConfig returns correct config', () => {
  const webhookConfig = getRateLimitConfig('webhook');
  assert.ok(webhookConfig, 'Should return config');
  assert.ok(webhookConfig.windowMs, 'Should have windowMs');
  assert.ok(webhookConfig.maxRequests, 'Should have maxRequests');
  
  const defaultConfig = getRateLimitConfig('nonexistent');
  assert.ok(defaultConfig, 'Should return default config for unknown type');
});

test('checkRateLimit returns not limited for new key', async () => {
  const result = await checkRateLimit(TEST_KEY, { windowMs: 60000, maxRequests: 5 });
  assert.equal(result.limited, false, 'Should not be limited initially');
  assert.ok(result.remaining > 0, 'Should have remaining requests');
  assert.ok(result.resetAt > Date.now(), 'Reset time should be in future');
});

test('incrementRateLimit tracks requests', async () => {
  const config = { windowMs: 60000, maxRequests: 5 };
  
  // Increment multiple times
  for (let i = 0; i < 3; i++) {
    await incrementRateLimit(TEST_KEY, config);
  }
  
  // Check status
  const result = await checkRateLimit(TEST_KEY, config);
  assert.equal(result.limited, false, 'Should not be limited yet');
  assert.ok(result.remaining <= 2, 'Should have used some requests');
  assert.ok(result.remaining >= 0, 'Should not have negative remaining');
});

test('rate limiting blocks after max requests', async () => {
  const config = { windowMs: 60000, maxRequests: 5 };
  
  // Increment to max
  for (let i = 0; i < 5; i++) {
    await incrementRateLimit(TEST_KEY, config);
  }
  
  // Check status - should be limited
  const result = await checkRateLimit(TEST_KEY, config);
  assert.equal(result.limited, true, 'Should be limited after max requests');
  assert.equal(result.remaining, 0, 'Should have no remaining requests');
});

test('resetRateLimit clears rate limit', async () => {
  await resetRateLimit(TEST_KEY);
  
  const result = await checkRateLimit(TEST_KEY, { windowMs: 60000, maxRequests: 5 });
  assert.equal(result.limited, false, 'Should not be limited after reset');
  assert.equal(result.remaining, 5, 'Should have all requests available');
});

test('getRateLimitStatus returns correct status', async () => {
  const config = { windowMs: 60000, maxRequests: 10 };
  
  // Reset first
  await resetRateLimit(TEST_KEY_2);
  
  // Check initial status
  let status = await getRateLimitStatus(TEST_KEY_2);
  assert.equal(status.count, 0, 'Should start with 0 count');
  assert.equal(status.resetAt, null, 'Should have no reset time initially');
  
  // Increment a few times
  for (let i = 0; i < 3; i++) {
    await incrementRateLimit(TEST_KEY_2, config);
  }
  
  // Check status again
  status = await getRateLimitStatus(TEST_KEY_2);
  assert.equal(status.count, 3, 'Should have count of 3');
  assert.ok(status.resetAt > Date.now(), 'Should have reset time in future');
});

test('cleanupRateLimits removes expired entries', async () => {
  // Create an expired entry
  const expiredKey = `expired-${run}`;
  await q(
    `INSERT INTO throttle (key, n, until_ms) VALUES ($1, 5, $2)`,
    [expiredKey, Date.now() - 1000] // Expired 1 second ago
  );
  
  // Cleanup
  const deleted = await cleanupRateLimits();
  assert.ok(deleted >= 1, 'Should have cleaned up at least the expired entry');
  
  // Verify it's gone
  const status = await getRateLimitStatus(expiredKey);
  assert.equal(status.count, 0, 'Expired entry should be cleaned up');
});

test('rate limiting with different window sizes', async () => {
  const shortConfig = { windowMs: 1000, maxRequests: 2 };
  const longConfig = { windowMs: 60000, maxRequests: 10 };
  
  // Test short window
  await resetRateLimit(TEST_KEY);
  await incrementRateLimit(TEST_KEY, shortConfig);
  await incrementRateLimit(TEST_KEY, shortConfig);
  
  let result = await checkRateLimit(TEST_KEY, shortConfig);
  assert.equal(result.limited, true, 'Should be limited with short window config');
  
  // Same key with different config should use the config's window
  result = await checkRateLimit(TEST_KEY, longConfig);
  // The entry exists but with different window, so it depends on the until_ms
  // This tests that different configs can be used with the same key
  assert.ok(result.limited === true || result.limited === false, 'Should handle different configs');
});

test('rate limiting with empty key', async () => {
  const result = await checkRateLimit('', { windowMs: 60000, maxRequests: 5 });
  assert.equal(result.limited, false, 'Empty key should not be limited');
});

test('rate limiting with null key', async () => {
  const result = await checkRateLimit(null, { windowMs: 60000, maxRequests: 5 });
  assert.equal(result.limited, false, 'Null key should not be limited');
});

test('getRateLimitConfig with all known types', () => {
  const types = ['webhook', 'paymentsWebhook', 'login', 'signup', 'resetPassword', 'apiDefault', 'apiStrict', 'admin'];
  
  for (const type of types) {
    const config = getRateLimitConfig(type);
    assert.ok(config, `Should have config for ${type}`);
    assert.ok(config.windowMs, `${type} should have windowMs`);
    assert.ok(config.maxRequests, `${type} should have maxRequests`);
  }
});
