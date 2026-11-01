// Invite rewards are worked out in USD and turned into BTC at the market price of the day they were earned (the first
// purchase reward on the day it started, each daily share on its own day), not at the static BTC_USD. Without market
// prices the static price is still used.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool } = await import('@/lib/server/db');
const referrals = await import('@/lib/server/referrals');
const { BTC_USD } = await import('@/lib/data');

after(async () => {
  await pool().end();
});

const DAY = 86400000;
const today = Math.floor(Date.now() / DAY) * DAY;
const T = today - 3 * DAY; // the reward started three days ago, so three whole days have been paid
const S = { ...referrals.DEFAULTS };

// An inviter with one friend who spent $1000 in one miner paying $100 a day. First reward 3% = $30, daily share 1% = $1 a day.
const ctxWith = (market) => ({
  id: 'inv@test.dev',
  u: { id: 'inv@test.dev', refCode: 'VTX-TEST', refCodes: [], contracts: [] },
  inviter: null,
  S,
  market,
  friends: [{ id: 'fr@test.dev', refAt: T, refRewardAt: T, refFirstUsd: 1000, contracts: [{ plan: 'Plan', price: 1000, dailyUsd: 100, days: 90, startedAt: T }] }],
});

test('each reward is turned into BTC at the price of its own day', () => {
  const market = { days: { [T]: { btc: 50000 }, [T + DAY]: { btc: 100000 }, [T + 2 * DAY]: { btc: 200000 } }, live: null, halls: {} };
  const ctx = ctxWith(market);
  const want = 30 / 50000 + 1 / 50000 + 1 / 100000 + 1 / 200000;
  assert.ok(Math.abs(referrals.rewardBtcOf(ctx) - want) < 1e-12, `${referrals.rewardBtcOf(ctx)} vs ${want}`);
  assert.equal(referrals.summaryOf(ctx).earnedBtc, want.toFixed(8));
  // The wallet rows add up to the same amount.
  const rows = referrals.historyOfCtx(ctx);
  assert.equal(rows.length, 2);
  const sum = rows.reduce((s, r) => s + Number(r.amount), 0);
  assert.ok(Math.abs(sum - want) < 2e-8);
});

test('a finished day does not move when the price moves later', () => {
  const a = referrals.rewardBtcOf(ctxWith({ days: { [T]: { btc: 50000 }, [T + DAY]: { btc: 100000 }, [T + 2 * DAY]: { btc: 200000 } }, live: { btc: 90000 }, halls: {} }));
  const b = referrals.rewardBtcOf(ctxWith({ days: { [T]: { btc: 50000 }, [T + DAY]: { btc: 100000 }, [T + 2 * DAY]: { btc: 200000 } }, live: { btc: 400000 }, halls: {} }));
  assert.equal(a, b, 'only today follows the live price, and today pays nothing yet');
});

test('with no market prices the static price is used', () => {
  const ctx = ctxWith(null);
  const want = (30 + 3) / BTC_USD; // $30 first reward + 3 days x $1
  assert.ok(Math.abs(referrals.rewardBtcOf(ctx) - want) < 1e-12);
});

test('the cap is kept: a friend never earns more than capPct of what they spent', () => {
  const ctx = ctxWith({ days: { [T]: { btc: 50000 } }, live: null, halls: {} });
  ctx.S = { ...S, firstPct: 10, capPct: 1 }; // $100 first reward, but capped at $10
  const btc = referrals.rewardBtcOf(ctx);
  assert.ok(Math.abs(btc - 10 / 50000) < 1e-12, `${btc}`);
});
