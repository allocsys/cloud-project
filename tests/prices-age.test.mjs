// Money code must not use an old price: pricesFor refuses a coin whose last real reading is older than MAX_AGE (30 min).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool } = await import('@/lib/server/db');
const prices = await import('@/lib/server/prices');

after(async () => {
  await pool.end();
});

// Runs fn with the live feed switched on (no network: the state is made fresh so nothing is fetched), then restores everything.
async function live(seen, fn) {
  const s = globalThis.__vtxPrices;
  const was = { feed: process.env.PRICE_FEED, seen: s.seen, at: s.at, trendAt: s.trendAt, loadP: s.loadP, source: s.source };
  delete process.env.PRICE_FEED;
  s.seen = seen;
  s.at = Date.now();
  s.trendAt = Date.now();
  s.loadP = Promise.resolve();
  s.source = 'live';
  try {
    return await fn();
  } finally {
    if (was.feed === undefined) delete process.env.PRICE_FEED;
    else process.env.PRICE_FEED = was.feed;
    Object.assign(s, { seen: was.seen, at: was.at, trendAt: was.trendAt, loadP: was.loadP, source: was.source });
  }
}

test('a price read a minute ago is accepted', async () => {
  await live({ btc: Date.now() - 60_000 }, async () => {
    assert.equal((await prices.pricesFor(['btc'])).ok, true);
  });
});

test('a price older than 30 minutes is refused', async () => {
  await live({ btc: Date.now() - 31 * 60_000 }, async () => {
    assert.equal((await prices.pricesFor(['btc'])).ok, false);
  });
});

test('a coin that never had a real price is refused, and one old coin refuses the whole request', async () => {
  await live({}, async () => {
    assert.equal((await prices.pricesFor(['btc'])).ok, false);
  });
  await live({ btc: Date.now() - 1000, eth: Date.now() - 2 * 3600_000 }, async () => {
    assert.equal((await prices.pricesFor(['btc'])).ok, true);
    assert.equal((await prices.pricesFor(['btc', 'eth'])).ok, false);
  });
});

test('the pegged coin never goes stale, and static mode allows everything', async () => {
  await live({}, async () => {
    assert.equal((await prices.pricesFor(['usdt'])).ok, true);
  });
  const was = process.env.PRICE_FEED;
  process.env.PRICE_FEED = 'static';
  try {
    assert.equal((await prices.pricesFor(['btc', 'eth'])).ok, true);
  } finally {
    if (was === undefined) delete process.env.PRICE_FEED;
    else process.env.PRICE_FEED = was;
  }
});
