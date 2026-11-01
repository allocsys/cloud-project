// Step 9 cleanup: the network key of an address (IPv4 /24, IPv6 /64) is the same however the address is written.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');
const { netKeyOf } = await import('@/lib/server/auth');

before(async () => {
  await migrate();
});

after(async () => {
  await pool().end();
});

test('IPv6: the same /64 gives the same key, whatever the shorthand', async () => {
  const k = await netKeyOf('2001:db8::1');
  assert.ok(k);
  assert.equal(await netKeyOf('2001:db8::2'), k, 'a second host of the same /64');
  assert.equal(await netKeyOf('2001:0db8:0:0:aaaa:bbbb:cccc:dddd'), k, 'written out in full');
  assert.equal(await netKeyOf('2001:DB8:0:0::9'), k, 'upper case, shorter run of zeros');
  assert.equal(await netKeyOf('2001:db8:0:1::1'), await netKeyOf('2001:db8:0:1:ffff::'), 'another /64, two ways');
  assert.notEqual(await netKeyOf('2001:db8:0:1::1'), k, 'a different /64 is a different key');
  assert.notEqual(await netKeyOf('2001:db9::1'), k);
});

test('IPv6: "::" at the start or end, and addresses that are not valid', async () => {
  assert.ok(await netKeyOf('::1'));
  assert.equal(await netKeyOf('::1'), await netKeyOf('0:0:0:0:0:0:0:5'));
  assert.ok(await netKeyOf('fe80::'));
  for (const bad of ['1::2::3', '2001:db8', '2001:db8:::1', 'gggg::1', '1:2:3:4:5:6:7:8:9']) assert.equal(await netKeyOf(bad), '', bad);
});

test('IPv4 and the other cases are as before', async () => {
  const k = await netKeyOf('203.0.113.7');
  assert.ok(k);
  assert.equal(await netKeyOf('203.0.113.200'), k, 'same /24');
  assert.equal(await netKeyOf('::ffff:203.0.113.9'), k, 'IPv4 inside IPv6');
  assert.notEqual(await netKeyOf('203.0.114.7'), k);
  for (const none of ['', 'unknown', null, undefined, '1.2.3']) assert.equal(await netKeyOf(none), '', String(none));
});
