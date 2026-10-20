import test from 'node:test';
import assert from 'node:assert/strict';
import { halls } from '@/lib/data';
import { MAINT_PER_TH_DAY, hallRates, dailyCosts, fmtCost } from '@/lib/fees';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

test('electricity per TH/s per day follows each hall: J/TH x 24 h x $/kWh', () => {
  near(hallRates(halls['tx-1']).elec, 0.0168);
  near(hallRates(halls['is-2']).elec, 0.018);
  near(hallRates(halls['no-1']).elec, 0.01152);
});

test('maintenance is a flat $0.002 per TH/s per day', () => {
  assert.equal(MAINT_PER_TH_DAY, 0.002);
  for (const h of Object.values(halls)) near(hallRates(h).maint, 0.002);
});

test('daily costs scale with the hash power', () => {
  const c = dailyCosts(100, halls['is-2']);
  near(c.elec, 1.8);
  near(c.maint, 0.2);
  near(dailyCosts(15, halls['tx-1']).elec, 0.252);
  near(dailyCosts(15, halls['tx-1']).maint, 0.03);
});

test('costs stay below what a TH/s earns, so the estimate after them is positive', () => {
  for (const h of Object.values(halls)) {
    const r = hallRates(h);
    assert.ok(r.elec + r.maint < 0.0398, h.name);
  }
});

test('a hall that does not state its numbers shows nothing', () => {
  assert.equal(hallRates(null), null);
  assert.equal(hallRates({}), null);
  assert.equal(hallRates({ efficiency: '15 J/TH' }), null);
  assert.equal(hallRates({ power: '$0.05/kWh' }), null);
  assert.equal(hallRates({ efficiency: '0 J/TH', power: '$0.05/kWh' }), null);
  assert.equal(dailyCosts(0, halls['tx-1']), null);
  assert.equal(dailyCosts(-5, halls['tx-1']), null);
});

test('amounts are shown with enough decimals', () => {
  assert.equal(fmtCost(1.8), '1.80');
  assert.equal(fmtCost(0.0168), '0.017');
  assert.equal(fmtCost(0.2), '0.20');
});
