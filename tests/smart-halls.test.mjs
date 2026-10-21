import test from 'node:test';
import assert from 'node:assert/strict';
import { SMART_HALLS, smartHallFor, contractedRate, machineOn } from '@/lib/smart-halls';

const smart = { smart: true, budget: 1000, baseYield: 0.01 }; // $10 a day at the reference

test('every coin has a hall of the right kind', () => {
  assert.equal(smartHallFor('BTC').kind, 'asic');
  assert.equal(smartHallFor('KAS').kind, 'gpu');
  assert.equal(smartHallFor('RVN').kind, 'gpu');
  assert.equal(smartHallFor('XMR').kind, 'cpu');
  assert.equal(smartHallFor('BTC').id, 'sm-asic');
});

test('a coin with no hall gives null', () => {
  assert.equal(smartHallFor('DOGE'), null);
  assert.equal(smartHallFor(undefined), null);
});

test('hall names are unique and each hall states a place and a rig', () => {
  const names = Object.values(SMART_HALLS).map((h) => h.name);
  assert.equal(new Set(names).size, names.length);
  for (const h of Object.values(SMART_HALLS)) assert.ok(h.place && h.rig && h.power);
});

test('contractedRate: the daily payout at the reference divided by the coin gross per unit', () => {
  assert.equal(contractedRate(smart, 0.05), 200); // $10 a day at $0.05 per unit per day
  assert.equal(contractedRate(smart, 2), 5);
});

test('contractedRate: null for a non-Smart miner, a missing reference or no budget', () => {
  assert.equal(contractedRate({ th: 10 }, 0.05), null);
  assert.equal(contractedRate(smart, null), null);
  assert.equal(contractedRate(smart, 0), null);
  assert.equal(contractedRate({ smart: true, budget: 0, baseYield: 0.01 }, 0.05), null);
  assert.equal(contractedRate(null, 0.05), null);
});

test('machineOn: hall, unit and rate together, or null when either is missing', () => {
  const m = machineOn(smart, 'KAS', 0.05, 'GH/s');
  assert.equal(m.hall.id, 'sm-gpu');
  assert.equal(m.unit, 'GH/s');
  assert.equal(m.rate, 200);
  assert.equal(machineOn(smart, 'DOGE', 0.05, 'GH/s'), null);
  assert.equal(machineOn(smart, 'KAS', null, 'GH/s'), null);
});
