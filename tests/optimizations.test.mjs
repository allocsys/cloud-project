// Comprehensive tests for optimization features
// Tests database indexes, pagination, rate limiting, and error handling

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { pool, q, allUsers, allUserIds, getUserCount, withUser, createUser, getUser } from '@/lib/server/db';
import { checkRateLimit, incrementRateLimit, resetRateLimit, getRateLimitConfig, RATE_LIMITS } from '@/lib/server/rate-limit';
import { 
  AppError, ValidationError, AuthenticationError, AuthorizationError, 
  NotFoundError, ConflictError, RateLimitError, ServiceUnavailableError,
  BadRequestError, validationError, notFoundError, conflictError, 
  unauthorizedError, forbiddenError, isAppError
} from '@/lib/server/errors';
import { 
  generateRequestId, setRequestId, getRequestId, setUserId, getUserId,
  clearContext, getLogLevel, shouldLog, formatLog, sanitizeLogEntry,
  logQuery, createLogger
} from '@/lib/server/logging';
import { getPrices } from '@/lib/server/prices';

// Test setup
const TEST_USER_ID = `test-user-${Date.now()}`;
const TEST_RATE_LIMIT_KEY = `test-rl-${Date.now()}`;

describe('Optimizations Tests', () => {
  
  before(async () => {
    // Ensure database is ready
    await pool();
  });

  after(async () => {
    // Cleanup test data
    try {
      await q('DELETE FROM users WHERE id = $1', [TEST_USER_ID]);
      await resetRateLimit(TEST_RATE_LIMIT_KEY);
    } catch (e) {
      // Ignore cleanup errors
    }
    clearContext();
  });

  describe('Database Indexes and Pagination', () => {
    
    it('allUserIds should return array of user IDs', async () => {
      const ids = await allUserIds();
      assert(Array.isArray(ids), 'Should return array');
      assert(ids.every(id => typeof id === 'string'), 'All IDs should be strings');
    });

    it('allUserIds should support pagination with offset', async () => {
      const ids1 = await allUserIds(pool(), 0, 10);
      const ids2 = await allUserIds(pool(), 10, 10);
      
      assert(Array.isArray(ids1), 'First page should be array');
      assert(Array.isArray(ids2), 'Second page should be array');
      
      // Ensure no overlap
      const overlap = ids1.filter(id => ids2.includes(id));
      assert(overlap.length === 0, 'Pages should not overlap');
    });

    it('allUsers should support cursor-based pagination', async () => {
      const firstPage = await allUsers(10);
      assert(Array.isArray(firstPage), 'First page should be array');
      
      if (firstPage.length > 0) {
        const lastUser = firstPage[firstPage.length - 1];
        const cursor = {
          created_at: lastUser.createdAt,
          id: lastUser.id
        };
        
        const secondPage = await allUsers(10, pool(), cursor);
        assert(Array.isArray(secondPage), 'Second page should be array');
        
        // Ensure no overlap
        const overlap = firstPage.filter(u => secondPage.some(v => v.id === u.id));
        assert(overlap.length === 0, 'Pages should not overlap with cursor');
      }
    });

    it('getUserCount should return total user count', async () => {
      const count = await getUserCount();
      assert(typeof count === 'number', 'Count should be number');
      assert(count >= 0, 'Count should be non-negative');
    });

    it('withUser should lock and retrieve user', async () => {
      const testUser = await withUser(TEST_USER_ID, (u, c) => {
        if (!u) {
          // Create test user
          return createUser(c, TEST_USER_ID, { email: TEST_USER_ID });
        }
        return u;
      });
      
      assert(testUser !== null, 'Should return user');
      assert(testUser.id === TEST_USER_ID, 'Should have correct ID');
    });
  });

  describe('Rate Limiting', () => {
    
    it('RATE_LIMITS should have all expected configurations', () => {
      assert(RATE_LIMITS.webhook, 'Should have webhook config');
      assert(RATE_LIMITS.login, 'Should have login config');
      assert(RATE_LIMITS.apiDefault, 'Should have apiDefault config');
      assert(RATE_LIMITS.admin, 'Should have admin config');
    });

    it('getRateLimitConfig should return correct config', () => {
      const webhookConfig = getRateLimitConfig('webhook');
      assert(webhookConfig, 'Should return config');
      assert(webhookConfig.windowMs, 'Should have windowMs');
      assert(webhookConfig.maxRequests, 'Should have maxRequests');
    });

    it('checkRateLimit should return limit status', async () => {
      // First check - should not be limited
      const result1 = await checkRateLimit(TEST_RATE_LIMIT_KEY, {
        windowMs: 60000,
        maxRequests: 5
      });
      
      assert(result1.limited === false, 'Should not be limited initially');
      assert(result1.remaining > 0, 'Should have remaining requests');
    });

    it('incrementRateLimit should track requests', async () => {
      const config = { windowMs: 60000, maxRequests: 5 };
      
      // Increment multiple times
      for (let i = 0; i < 3; i++) {
        await incrementRateLimit(TEST_RATE_LIMIT_KEY, config);
      }
      
      // Check status
      const result = await checkRateLimit(TEST_RATE_LIMIT_KEY, config);
      assert(result.remaining <= 2, 'Should have used some requests');
    });

    it('rate limiting should block after max requests', async () => {
      const config = { windowMs: 60000, maxRequests: 5 };
      
      // Increment to max
      for (let i = 0; i < 5; i++) {
        await incrementRateLimit(TEST_RATE_LIMIT_KEY, config);
      }
      
      // Check status - should be limited
      const result = await checkRateLimit(TEST_RATE_LIMIT_KEY, config);
      assert(result.limited === true, 'Should be limited after max requests');
      assert(result.remaining === 0, 'Should have no remaining requests');
    });

    it('resetRateLimit should clear rate limit', async () => {
      await resetRateLimit(TEST_RATE_LIMIT_KEY);
      
      const result = await checkRateLimit(TEST_RATE_LIMIT_KEY, {
        windowMs: 60000,
        maxRequests: 5
      });
      
      assert(result.limited === false, 'Should not be limited after reset');
    });
  });

  describe('Error Handling', () => {
    
    it('AppError should have correct properties', () => {
      const error = new AppError('Test error', 400, 'testField', { detail: 'test' });
      
      assert(error.message === 'Test error', 'Should have message');
      assert(error.status === 400, 'Should have status');
      assert(error.field === 'testField', 'Should have field');
      assert(error.details.detail === 'test', 'Should have details');
      assert(error.isAppError === true, 'Should be marked as AppError');
      assert(error.name === 'AppError', 'Should have correct name');
    });

    it('AppError.toJSON should return correct format', () => {
      const error = new AppError('Test error', 400, 'testField');
      const json = error.toJSON();
      
      assert(json.ok === false, 'Should have ok: false');
      assert(json.error === 'Test error', 'Should have error message');
      assert(json.field === 'testField', 'Should have field');
      assert(json.timestamp, 'Should have timestamp');
    });

    it('ValidationError should extend AppError', () => {
      const error = new ValidationError('Invalid input', 'email');
      assert(error instanceof AppError, 'Should be AppError');
      assert(error.status === 422, 'Should have 422 status');
      assert(error.name === 'ValidationError', 'Should have correct name');
    });

    it('AuthenticationError should have 401 status', () => {
      const error = new AuthenticationError();
      assert(error.status === 401, 'Should have 401 status');
      assert(error.name === 'AuthenticationError', 'Should have correct name');
    });

    it('AuthorizationError should have 403 status', () => {
      const error = new AuthorizationError();
      assert(error.status === 403, 'Should have 403 status');
      assert(error.name === 'AuthorizationError', 'Should have correct name');
    });

    it('NotFoundError should have 404 status', () => {
      const error = new NotFoundError('User not found', 'user', '123');
      assert(error.status === 404, 'Should have 404 status');
      assert(error.details.resourceType === 'user', 'Should have resource type');
      assert(error.details.resourceId === '123', 'Should have resource ID');
    });

    it('ConflictError should have 409 status', () => {
      const error = new ConflictError('Already exists', 'email');
      assert(error.status === 409, 'Should have 409 status');
      assert(error.field === 'email', 'Should have field');
    });

    it('RateLimitError should have 429 status', () => {
      const error = new RateLimitError('Too many requests', 60);
      assert(error.status === 429, 'Should have 429 status');
      assert(error.retryAfter === 60, 'Should have retryAfter');
    });

    it('ServiceUnavailableError should have 503 status', () => {
      const error = new ServiceUnavailableError('Service down', 30);
      assert(error.status === 503, 'Should have 503 status');
    });

    it('BadRequestError should have 400 status', () => {
      const error = new BadRequestError('Bad request', 'query');
      assert(error.status === 400, 'Should have 400 status');
    });

    it('helper functions should create correct error types', () => {
      assert(validationError('field', 'msg') instanceof ValidationError);
      assert(notFoundError('user', '123') instanceof NotFoundError);
      assert(conflictError('msg', 'field') instanceof ConflictError);
      assert(unauthorizedError('msg') instanceof AuthenticationError);
      assert(forbiddenError('msg') instanceof AuthorizationError);
    });

    it('isAppError should identify AppError instances', () => {
      assert(isAppError(new AppError('test')) === true);
      assert(isAppError(new Error('test')) === false);
      assert(isAppError(new ValidationError('test')) === true);
    });
  });

  describe('Logging Utilities', () => {
    
    it('generateRequestId should return UUID', () => {
      const id = generateRequestId();
      assert(typeof id === 'string', 'Should be string');
      assert(id.length > 30, 'Should be UUID length');
    });

    it('setRequestId and getRequestId should work', () => {
      const id = generateRequestId();
      setRequestId(id);
      assert(getRequestId() === id, 'Should return set ID');
      clearContext();
    });

    it('setUserId and getUserId should work', () => {
      const userId = 'test-user';
      setUserId(userId);
      assert(getUserId() === userId, 'Should return set user ID');
      clearContext();
    });

    it('clearContext should clear all context', () => {
      setRequestId('req-1');
      setUserId('user-1');
      clearContext();
      assert(getRequestId() === null, 'Should clear request ID');
      assert(getUserId() === null, 'Should clear user ID');
    });

    it('getLogLevel should return environment value or default', () => {
      const level = getLogLevel();
      assert(['error', 'warn', 'info', 'debug', 'trace'].includes(level), 'Should be valid level');
    });

    it('shouldLog should respect log level', () => {
      const level = getLogLevel();
      assert(shouldLog('error') === true, 'Error should always log');
      assert(shouldLog('warn') === true, 'Warn should always log');
      assert(shouldLog('info') === true, 'Info should always log');
    });

    it('formatLog should return JSON string', () => {
      const log = formatLog('info', 'Test message', { key: 'value' });
      const parsed = JSON.parse(log);
      assert(parsed.level === 'info', 'Should have level');
      assert(parsed.message === 'Test message', 'Should have message');
      assert(parsed.key === 'value', 'Should have metadata');
      assert(parsed.timestamp, 'Should have timestamp');
    });

    it('sanitizeLogEntry should redact sensitive fields', () => {
      const entry = sanitizeLogEntry({
        password: 'secret',
        token: 'abc123',
        normal: 'value'
      });
      
      assert(entry.password === '[REDACTED]', 'Should redact password');
      assert(entry.token === '[REDACTED]', 'Should redact token');
      assert(entry.normal === 'value', 'Should keep normal fields');
    });

    it('sanitizeLogEntry should handle nested objects', () => {
      const entry = sanitizeLogEntry({
        user: {
          password: 'secret',
          email: 'test@example.com'
        }
      });
      
      assert(entry.user.password === '[REDACTED]', 'Should redact nested password');
      assert(entry.user.email === 'test@example.com', 'Should keep nested email');
    });

    it('logQuery should not throw with invalid query', () => {
      // Should not throw even with invalid query
      logQuery('SELECT * FROM users', ['param1'], 100);
    });

    it('createLogger should create logger with context', () => {
      const logger = createLogger({ service: 'test' });
      assert(typeof logger.error === 'function', 'Should have error method');
      assert(typeof logger.warn === 'function', 'Should have warn method');
      assert(typeof logger.info === 'function', 'Should have info method');
      assert(typeof logger.debug === 'function', 'Should have debug method');
      assert(typeof logger.trace === 'function', 'Should have trace method');
      assert(typeof logger.child === 'function', 'Should have child method');
    });
  });

  describe('Price Cache', () => {
    
    it('getPrices should return prices object', async () => {
      const { prices, at, source } = await getPrices();
      assert(prices, 'Should have prices');
      assert(typeof prices === 'object', 'Prices should be object');
      assert(prices.btc, 'Should have BTC price');
      assert(typeof at === 'number', 'Should have timestamp');
      assert(source, 'Should have source');
    });

    it('prices should have expected coins', async () => {
      const { prices } = await getPrices();
      const expectedCoins = ['btc', 'eth', 'bnb', 'trx', 'usdt', 'ton'];
      
      for (const coin of expectedCoins) {
        assert(coin in prices, `Should have ${coin} price`);
        assert(typeof prices[coin] === 'number', `${coin} should be number`);
        assert(prices[coin] > 0, `${coin} should be positive`);
      }
    });
  });
});

describe('Edge Cases and Error Handling', () => {
  
  it('allUserIds with invalid offset should handle gracefully', async () => {
    const ids = await allUserIds(pool(), -10, 10);
    assert(Array.isArray(ids), 'Should return array even with negative offset');
  });

  it('allUsers with invalid limit should handle gracefully', async () => {
    const users = await allUsers(-10);
    assert(Array.isArray(users), 'Should return array even with negative limit');
  });

  it('checkRateLimit with empty key should work', async () => {
    const result = await checkRateLimit('', { windowMs: 60000, maxRequests: 5 });
    assert(result.limited === false, 'Empty key should not be limited');
  });

  it('AppError with no arguments should have defaults', () => {
    const error = new AppError();
    assert(error.message === '', 'Should have empty message');
    assert(error.status === 500, 'Should default to 500');
    assert(error.field === null, 'Should default to null field');
  });

  it('sanitizeLogEntry with null should return empty object', () => {
    const result = sanitizeLogEntry(null);
    assert.deepStrictEqual(result, {}, 'Should handle null');
  });

  it('sanitizeLogEntry with undefined should return empty object', () => {
    const result = sanitizeLogEntry(undefined);
    assert.deepStrictEqual(result, {}, 'Should handle undefined');
  });
});
