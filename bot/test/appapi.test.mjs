// The bot's own calls to the app: which address they use.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeAppApi } from '../src/appapi.js';

const fake = () => {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  return { calls, fetchFn };
};
const base = { notifySecret: 's'.repeat(20), appUrl: 'https://vertexhash.com' };

test('calls go to APP_API_URL when it is set (the private address)', async () => {
  const f = fake();
  const call = makeAppApi({ config: { ...base, appApiUrl: 'http://api.railway.internal:8080' }, fetchFn: f.fetchFn });
  const r = await call('balance', { tg_id: 1 });
  assert.equal(r.ok, true);
  assert.deepEqual(f.calls, ['http://api.railway.internal:8080/api/bot/balance']);
});

test('without APP_API_URL the calls use the public address', async () => {
  const f = fake();
  await makeAppApi({ config: base, fetchFn: f.fetchFn })('earnings', { tg_id: 1 });
  await makeAppApi({ config: { ...base, appApiUrl: '' }, fetchFn: f.fetchFn })('referrals', { tg_id: 1 });
  assert.deepEqual(f.calls, ['https://vertexhash.com/api/bot/earnings', 'https://vertexhash.com/api/bot/referrals']);
});
