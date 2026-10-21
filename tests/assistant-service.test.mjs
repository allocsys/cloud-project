import test from 'node:test';
import assert from 'node:assert/strict';
import { ask } from '../lib/server/assistant-service.js';

const NOW = Date.parse('2026-10-20T12:00:00Z');

// Fake data sources; makeLlm records the snapshot it was given.
function deps(over = {}) {
  const seen = { snapshot: null, userId: null };
  return {
    seen,
    d: {
      now: () => NOW,
      getUser: async () => ({ contracts: [] }),
      getWallet: async () => ({ earned: 0.002, mined: 0.002, withdrawn: 0.0005, spent: 0.0003, history: [] }),
      getPrices: async () => ({ prices: { btc: 80000 } }),
      getMarket: async () => null,
      getTelemetry: async () => null,
      answersLeft: () => 17,
      makeLlm: (userId, snapshot) => {
        seen.userId = userId;
        seen.snapshot = snapshot;
        return async () => 'Your balance is about $96.';
      },
      ...over,
    },
  };
}

test('an open question goes to the LLM with the user snapshot, and returns what is left', async () => {
  const { d, seen } = deps();
  const r = await ask('u1', 'zzqx wibble flonk', d);
  assert.equal(r.source, 'llm');
  assert.equal(r.text, 'Your balance is about $96.');
  assert.equal(r.left, 17);
  assert.equal(seen.userId, 'u1');
  assert.equal(seen.snapshot.btcUsd, 80000);
  assert.equal(seen.snapshot.balance.btc, 0.0012);
  assert.equal(seen.snapshot.balance.usd, 96);
});

test('no LLM answer (limit, no key, error): points to support instead of failing', async () => {
  const { d } = deps({ makeLlm: () => async () => null });
  const r = await ask('u1', 'zzqx wibble flonk', d);
  assert.equal(r.source, 'support');
  assert.ok(r.text.length > 0);
  assert.equal(r.left, 17);
});

test('an empty question never reaches the LLM', async () => {
  let called = false;
  const { d } = deps({ makeLlm: () => async () => { called = true; return 'x'; } });
  const r = await ask('u1', '   ', d);
  assert.equal(r.source, 'support');
  assert.equal(called, false);
});

test('a reply with a return promise is dropped', async () => {
  const { d } = deps({ makeLlm: () => async () => 'This is guaranteed profit for you.' });
  const r = await ask('u1', 'zzqx wibble flonk', d);
  assert.equal(r.source, 'support');
});

test('a data failure rejects, so the route can answer with a generic error', async () => {
  const { d } = deps({ getWallet: async () => { throw new Error('db down'); } });
  await assert.rejects(() => ask('u1', 'zzqx wibble flonk', d));
});
