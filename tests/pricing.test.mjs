import test from 'node:test';
import assert from 'node:assert/strict';
import { liveNet, priceHalls, PRICE_BUFFER, NET_FLOOR } from '@/lib/pricing';

// 17.5 J/TH at $0.04/kWh: electricity 0.0168, maintenance 0.002 per TH/s per day.
const texas = { efficiency: '17.5 J/TH', power: 'Wind and grid, $0.04/kWh', net: 0.0175 };
const bare = { efficiency: '', power: '', net: 0.0123 };

test('net is the live gross less the buffer, electricity and maintenance', () => {
  assert.equal(PRICE_BUFFER, 0.02);
  assert.equal(liveNet(0.04, texas), 0.0204); // 0.04 x 0.98 - 0.0168 - 0.002
});

test('net never falls below the floor, however low the feed goes', () => {
  assert.equal(liveNet(0.02, texas), NET_FLOOR);
});

test('without a live gross, or without hall cost numbers, the saved net is kept', () => {
  assert.equal(liveNet(0, texas), texas.net);
  assert.equal(liveNet(NaN, texas), texas.net);
  assert.equal(liveNet(0.04, bare), bare.net);
});

test('priceHalls reprices every hall and leaves the input untouched', () => {
  const halls = { a: texas, b: bare };
  const out = priceHalls(halls, 0.04);
  assert.equal(out.a.net, 0.0204);
  assert.equal(out.b.net, bare.net);
  assert.equal(halls.a.net, 0.0175);
  assert.equal(priceHalls(halls, 0), halls);
});
