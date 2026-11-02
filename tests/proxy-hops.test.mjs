// The caller's address behind Cloudflare + Railway (TRUSTED_PROXIES=2): read from the right, and a request with fewer entries
// than proxies (it skipped one) uses the last entry instead of "unknown".
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { addressOf } = await import('@/lib/rate-mem');
const h = (xff) => new Headers(xff ? { 'x-forwarded-for': xff } : {});

test('two proxies: the address is the second from the right', () => {
  assert.equal(addressOf(h('1.1.1.1, 9.9.9.9'), 2), '1.1.1.1');
  assert.equal(addressOf(h('6.6.6.6, 1.1.1.1, 9.9.9.9'), 2), '1.1.1.1', 'a forged first entry is ignored');
});

test('one entry with two proxies: that entry, not unknown', () => {
  assert.equal(addressOf(h('1.1.1.1'), 2), '1.1.1.1');
});

test('no header: unknown (not limited)', () => {
  assert.equal(addressOf(h(''), 2), null);
});

test('one proxy keeps working as before', () => {
  assert.equal(addressOf(h('6.6.6.6, 1.1.1.1'), 1), '1.1.1.1');
});
