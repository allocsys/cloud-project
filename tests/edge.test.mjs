// Edge guard: off without API_EDGE_SECRET; with it, /api needs x-vtx-edge, and x-vtx-ip is the address only with a valid edge header.
import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';
import { addressOf, clearCounters } from '@/lib/rate-mem';
import { edgeAddress, edgeFree } from '@/lib/edge';

const BROWSER = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';
const SECRET = 'edge-secret-for-tests-0123456789';
const call = (url, extra = {}) =>
  proxy(new NextRequest(`https://x.test${url}`, { headers: { 'x-forwarded-for': '203.0.113.7', 'user-agent': BROWSER, ...extra } }));
const passes = (res) => res.headers.get('x-middleware-next') === '1';

test('no secret set: the guard is off', () => {
  delete process.env.API_EDGE_SECRET;
  clearCounters();
  assert.ok(passes(call('/api/prices')));
  assert.equal(edgeAddress(new Headers({ 'x-vtx-ip': '1.2.3.4', 'x-vtx-edge': 'x' })), null);
});

test('secret set: /api without the header is refused, with it passes', async () => {
  process.env.API_EDGE_SECRET = SECRET;
  clearCounters();
  const no = call('/api/prices');
  assert.equal(no.status, 403);
  assert.equal(call('/api/prices', { 'x-vtx-edge': 'wrong' }).status, 403);
  assert.ok(passes(call('/api/prices', { 'x-vtx-edge': SECRET })));
  delete process.env.API_EDGE_SECRET;
});

test('secret set: health, webhook, telemetry and bot calls stay open; pages are untouched', () => {
  process.env.API_EDGE_SECRET = SECRET;
  clearCounters();
  for (const p of ['/api/health', '/api/payments/webhook', '/api/telemetry', '/api/bot/balance']) {
    assert.ok(edgeFree(p), p);
    assert.ok(passes(call(p)), p);
  }
  assert.ok(!edgeFree('/api/auth/login'));
  assert.ok(passes(call('/')));
  delete process.env.API_EDGE_SECRET;
});

test('web service: /api/site/* passes with the service secret, nothing else does', () => {
  process.env.API_EDGE_SECRET = SECRET;
  process.env.API_SVC_SECRET = 'svc-secret-for-tests-0123456789';
  clearCounters();
  const svc = { 'x-vtx-svc': 'svc-secret-for-tests-0123456789' };
  assert.ok(passes(call('/api/site/landing', svc)));
  assert.ok(passes(call('/api/site/status', svc)));
  assert.equal(call('/api/site/landing').status, 403, 'no secret');
  assert.equal(call('/api/site/landing', { 'x-vtx-svc': 'wrong' }).status, 403);
  assert.equal(call('/api/auth/login', svc).status, 403, 'the service secret opens only /api/site/*');
  assert.equal(call('/api/prices', svc).status, 403);
  delete process.env.API_SVC_SECRET;
  assert.equal(call('/api/site/landing', svc).status, 403, 'no service secret set on the API: nothing passes');
  delete process.env.API_EDGE_SECRET;
});

test('x-vtx-ip is trusted only with a valid edge header', () => {
  process.env.API_EDGE_SECRET = SECRET;
  const h = (o) => new Headers({ 'x-forwarded-for': '6.6.6.6, 9.9.9.9', ...o });
  assert.equal(addressOf(h({ 'x-vtx-ip': '1.1.1.1', 'x-vtx-edge': SECRET }), 1), '1.1.1.1');
  assert.equal(addressOf(h({ 'x-vtx-ip': '1.1.1.1' }), 1), '9.9.9.9', 'forged ip without the edge header is ignored');
  assert.equal(addressOf(h({ 'x-vtx-ip': '1.1.1.1', 'x-vtx-edge': 'wrong' }), 1), '9.9.9.9');
  assert.equal(addressOf(h({ 'x-vtx-edge': SECRET }), 1), '9.9.9.9', 'valid edge but no ip: falls back');
  delete process.env.API_EDGE_SECRET;
});
