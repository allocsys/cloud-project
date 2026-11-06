import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { middleware, config } from '@/middleware';
import { clearCounters, LIMITS, isTool } from '@/lib/rate-mem';

const BROWSER = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';
const call = (url, { ip = '203.0.113.7', ua = BROWSER, method = 'GET' } = {}) => {
  const headers = { 'x-forwarded-for': ip };
  if (ua) headers['user-agent'] = ua;
  return middleware(new NextRequest(`https://x.test${url}`, { method, headers }));
};

test('the API is behind the middleware, so the limits cover every route', () => {
  assert.ok(config.matcher.includes('/api/:path*'));
});

test('scraping tools are refused on the API and on public pages, browsers and link previews are not', () => {
  clearCounters();
  assert.equal(call('/api/prices', { ua: 'python-requests/2.31' }).status, 403);
  assert.equal(call('/', { ua: 'curl/8.4.0' }).status, 403);
  assert.equal(call('/api/prices', { ua: '' }).status, 403); // no user agent at all
  assert.equal(call('/api/prices').headers.get('x-middleware-next'), '1');
  assert.equal(call('/', { ua: 'TelegramBot (like TwitterBot)' }).headers.get('x-middleware-next'), '1');
  assert.equal(call('/', { ua: 'Mozilla/5.0 (compatible; Googlebot/2.1)' }).headers.get('x-middleware-next'), '1');
  assert.ok(isTool('Scrapy/2.11') && !isTool(BROWSER));
});

test('machine calls (payment webhook, hall monitoring, health) are never limited or blocked', () => {
  clearCounters();
  for (const p of ['/api/payments/webhook', '/api/telemetry', '/api/health', '/api/bot/balance']) {
    assert.equal(call(p, { ua: 'curl/8.4.0', method: 'POST' }).headers.get('x-middleware-next'), '1', p);
  }
});

test('one address sending far too many requests is answered with 429, another address is not', () => {
  clearCounters();
  for (let i = 0; i < LIMITS.write; i += 1) assert.notEqual(call('/api/plans/buy', { method: 'POST' }).status, 429);
  const slow = call('/api/plans/buy', { method: 'POST' });
  assert.equal(slow.status, 429);
  assert.equal(slow.headers.get('retry-after'), '60');
  assert.equal(call('/api/plans/buy', { method: 'POST', ip: '198.51.100.9' }).headers.get('x-middleware-next'), '1');
  // reading has its own, higher counter
  assert.equal(call('/api/prices').headers.get('x-middleware-next'), '1');
});

test('a call with no readable address is not limited', () => {
  clearCounters();
  const req = () => middleware(new NextRequest('https://x.test/api/prices', { headers: { 'user-agent': BROWSER } }));
  for (let i = 0; i < LIMITS.read + 5; i += 1) assert.equal(req().headers.get('x-middleware-next'), '1');
});
