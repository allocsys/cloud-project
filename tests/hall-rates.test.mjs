// Hall rate history (lib/fees.js): a rate change never moves a finished day, today, or an invite reward worked out from them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hallRates, ratesOn, rateLogFor } from '@/lib/fees';
import { buildEarnings, usdPerDay } from '@/lib/earnings';
import { halls } from '@/lib/data';

const DAY = 86400000;
const now = Date.parse('2026-11-28T12:00:00Z');
const today = Math.floor(now / DAY) * DAY;
const market = (h, at = now) => {
  const days = {};
  for (let k = -3; k <= 20; k += 1) if (today - k * DAY < Math.floor(at / DAY) * DAY) days[today - k * DAY] = { gross: 0.0398, btc: 85000 };
  return { days, live: { gross: 0.0398, btc: 85000 }, halls: { ...halls, 'tx-1': h } };
};
const miner = { serial: 'A', hall: 'tx-1', th: 100, days: 180, startedAt: today - 10 * DAY, online: true, dailyUsd: 1 };
const old = halls['tx-1'];
const dear = { ...old, power: 'Grid, $0.08/kWh' };
const saved = { ...dear, rateLog: rateLogFor(old, dear, today + DAY) };

test('past days, today and invite rewards keep their rates after a change', () => {
  const a = buildEarnings([miner], now, 85000, market(old));
  const b = buildEarnings([miner], now, 85000, market(saved));
  assert.equal(b.totalBtc, a.totalBtc);
  assert.deepEqual(b.earnings, a.earnings);
  assert.equal(usdPerDay(miner, today - DAY, market(saved), now), usdPerDay(miner, today - DAY, market(old), now));
});

test('the new rates are paid from the next day on', () => {
  const later = now + 2 * DAY;
  assert.ok(usdPerDay(miner, today + DAY, market(saved, later), later) < usdPerDay(miner, today, market(saved, later), later));
});

test('history: none without a change; a second change keeps the first', () => {
  assert.equal(rateLogFor(old, { ...old, name: 'Other' }, today), undefined);
  const next = rateLogFor(saved, { ...saved, power: 'Grid, $0.05/kWh' }, today + 5 * DAY);
  assert.equal(next.length, 3);
  const h = { ...old, rateLog: next };
  assert.deepEqual(ratesOn(h, today), hallRates(old));
  assert.deepEqual(ratesOn(h, today + DAY), hallRates(dear));
});
