import { NextResponse } from 'next/server';
import { q, pool } from '@/lib/server/db';
import { getPrices } from '@/lib/server/prices';
import { getMarket } from '@/lib/server/market';
import { getLogLevel } from '@/lib/server/logging';

export const dynamic = 'force-dynamic';

/**
 * Comprehensive health check endpoint
 * Returns status of all critical services
 * 
 * Endpoints:
 * - GET /api/health - Full health check (this)
 * - GET /api/health/live - Liveness probe (lightweight)
 * - GET /api/health/ready - Readiness probe (database + services)
 * - GET /api/health/db - Database connectivity
 * - GET /api/health/prices - Price feed status
 * - GET /api/health/market - Market data status
 */

// Liveness probe - always returns 200 if server is running
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const check = searchParams.get('check');
  
  switch (check) {
    case 'live':
      return livenessCheck();
    case 'ready':
      return readinessCheck();
    case 'db':
      return databaseCheck();
    case 'prices':
      return pricesCheck();
    case 'market':
      return marketCheck();
    default:
      return fullHealthCheck();
  }
}

/**
 * Liveness probe - server is running
 */
async function livenessCheck() {
  return NextResponse.json(
    { 
      ok: true, 
      status: 'live',
      timestamp: new Date().toISOString()
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

/**
 * Readiness probe - database and critical services
 */
async function readinessCheck() {
  try {
    const dbStatus = await databaseCheck();
    if (dbStatus.status !== 200) {
      return dbStatus;
    }
    
    const pricesStatus = await pricesCheck();
    const marketStatus = await marketCheck();
    
    const allOk = dbStatus.ok && pricesStatus.ok && marketStatus.ok;
    
    return NextResponse.json(
      {
        ok: allOk,
        status: allOk ? 'ready' : 'degraded',
        timestamp: new Date().toISOString(),
        checks: {
          database: dbStatus.ok,
          prices: pricesStatus.ok,
          market: marketStatus.ok
        }
      },
      { 
        status: allOk ? 200 : 503,
        headers: { 'Cache-Control': 'no-store' } 
      }
    );
  } catch (error) {
    return NextResponse.json(
      { 
        ok: false, 
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString()
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

/**
 * Database connectivity check
 */
async function databaseCheck() {
  try {
    const start = Date.now();
    await q('SELECT 1');
    const duration = Date.now() - start;
    
    // Get pool statistics
    const poolStats = pool().totalCount && pool().idleCount && pool().waitingCount ? {
      total: pool().totalCount,
      idle: pool().idleCount,
      waiting: pool().waitingCount
    } : {};
    
    return NextResponse.json(
      { 
        ok: true, 
        store: 'postgres',
        responseTimeMs: duration,
        ...poolStats
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return NextResponse.json(
      { 
        ok: false, 
        store: 'unavailable',
        error: error.message
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

/**
 * Price feed status check
 */
async function pricesCheck() {
  try {
    const { prices, at, source, trend } = await getPrices();
    const now = Date.now();
    const stale = now - at > 300_000; // 5 minutes
    
    return NextResponse.json(
      {
        ok: true,
        source,
        prices: Object.keys(prices),
        lastUpdatedAt: at,
        stale,
        trendAvailable: !!trend
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error.message,
        source: 'unavailable'
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

/**
 * Market data status check
 */
async function marketCheck() {
  try {
    const market = await getMarket();
    
    return NextResponse.json(
      {
        ok: true,
        daysCount: Object.keys(market.days || {}).length,
        liveAvailable: !!market.live,
        halls: Object.keys(market.halls || {})
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error.message
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

/**
 * Full health check - all services
 */
async function fullHealthCheck() {
  try {
    const [dbResult, pricesResult, marketResult] = await Promise.all([
      databaseCheck(),
      pricesCheck(),
      marketCheck()
    ]);
    
    const db = await dbResult.json();
    const prices = await pricesResult.json();
    const market = await marketResult.json();
    
    const allOk = db.ok && prices.ok && market.ok;
    
    return NextResponse.json(
      {
        ok: allOk,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development',
        logLevel: getLogLevel(),
        checks: {
          database: db,
          prices: prices,
          market: market
        }
      },
      { 
        status: allOk ? 200 : 503,
        headers: { 'Cache-Control': 'no-store' } 
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error.message,
        timestamp: new Date().toISOString()
      },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
