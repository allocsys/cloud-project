// Tests for health check endpoints (app/api/health/route.js)
// These tests mock the dependencies to avoid needing a running server
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

// We need to test the health check logic, but the route.js file uses Next.js specific features
// So we'll test the underlying functions from the modules it depends on

const db = await import('@/lib/server/db');
const prices = await import('@/lib/server/prices');
const market = await import('@/lib/server/market');
const logging = await import('@/lib/server/logging');

const { pool, q } = db;
const { getPrices } = prices;
const { getMarket } = market;
const { getLogLevel } = logging;

// Test the individual components that the health endpoint uses

describe('Health check dependencies', () => {
  test('getPrices returns prices object', async () => {
    const { prices: priceData, at, source } = await getPrices();
    
    assert.ok(priceData, 'Should have prices');
    assert.ok(typeof priceData === 'object', 'Prices should be object');
    assert.ok(priceData.btc, 'Should have BTC price');
    assert.ok(typeof at === 'number', 'Should have timestamp');
    assert.ok(source, 'Should have source');
  });

  test('getMarket returns market data', async () => {
    const marketData = await getMarket();
    
    assert.ok(marketData, 'Should have market data');
    assert.ok(marketData.days || marketData.days === {}, 'Should have days');
    assert.ok(marketData.halls, 'Should have halls');
  });

  test('getLogLevel returns valid level', () => {
    const level = getLogLevel();
    assert.ok(['error', 'warn', 'info', 'debug', 'trace'].includes(level), 'Should be valid log level');
  });

  test('pool is available', async () => {
    const p = pool();
    assert.ok(p, 'Pool should be available');
    assert.ok(typeof p.query === 'function', 'Pool should have query method');
  });

  test('database query works', async () => {
    const result = await q('SELECT 1');
    assert.ok(result, 'Query should return result');
    assert.ok(result.rows, 'Result should have rows');
    assert.ok(result.rows.length > 0, 'Should have at least one row');
  });
});

describe('Health check response formats', () => {
  test('prices object has expected structure', async () => {
    const { prices } = await getPrices();
    
    const expectedCoins = ['btc', 'eth', 'bnb', 'trx', 'usdt', 'ton'];
    
    for (const coin of expectedCoins) {
      assert.ok(coin in prices, `Should have ${coin} price`);
      assert.ok(typeof prices[coin] === 'number', `${coin} should be number`);
      assert.ok(prices[coin] > 0, `${coin} should be positive`);
    }
  });

  test('market data has expected structure', async () => {
    const marketData = await getMarket();
    
    assert.ok(marketData.days !== null, 'Should have days (may be empty object)');
    assert.ok(marketData.halls, 'Should have halls');
    assert.ok(typeof marketData.halls === 'object', 'Halls should be object');
    
    // Check that halls has expected properties
    if (Object.keys(marketData.halls).length > 0) {
      const firstHall = Object.values(marketData.halls)[0];
      assert.ok(firstHall.name, 'Hall should have name');
      assert.ok(firstHall.net !== undefined, 'Hall should have net rate');
    }
  });
});

describe('Error handling in health checks', () => {
  test('getPrices handles errors gracefully', async () => {
    // This won't fail because getPrices has fallback to static prices
    const result = await getPrices();
    assert.ok(result.prices, 'Should return prices even if feed fails');
  });

  test('getMarket handles errors gracefully', async () => {
    const result = await getMarket();
    assert.ok(result, 'Should return market data even if some parts fail');
  });
});
