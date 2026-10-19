// Explorer client tests. No network and no database: fetch is a stub.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { btcExplorer, ExplorerError } from '../src/explorer.js';

const ADDR = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const T1 = 'a'.repeat(64);
const T2 = 'b'.repeat(64);
const T3 = 'c'.repeat(64);
const BASE = 'https://explorer.test/api';

const routes = (txs, tip = '105') => ({
  [`/api/address/${ADDR}/txs`]: { body: typeof txs === 'string' ? txs : JSON.stringify(txs) },
  '/api/blocks/tip/height': { body: tip },
});
const stub = (map, calls = []) => async (url) => {
  calls.push(url);
  const r = map[new URL(url).pathname];
  if (!r) return new Response('not found', { status: 404 });
  return new Response(r.body, { status: r.status ?? 200 });
};
const explorer = (map, extra = {}) => btcExplorer({ baseUrl: BASE, fetchImpl: stub(map), ...extra });
const confirmed = (txid, height, vout) => ({ txid, status: { confirmed: true, block_height: height }, vout });
const mempool = (txid, vout) => ({ txid, status: { confirmed: false }, vout });
const to = (value, address = ADDR) => ({ scriptpubkey_address: address, value });
const isExplorerError = (re) => (e) => e instanceof ExplorerError && re.test(e.message);

test('reads outputs paying the address, with confirmations counted from the tip', async () => {
  const txs = [
    confirmed(T1, 100, [to(50000), to(999, 'bc1qsomeoneelse')]),
    mempool(T2, [to(1200), to(300)]),
    confirmed(T3, 105, [{ scriptpubkey_type: 'op_return', value: 0 }, to(5)]),
  ];
  const got = await explorer(routes(txs)).addressPayments(ADDR);
  assert.deepEqual(got, [
    { txid: T1, vout: 0, amount: '50000', confirmations: 6, height: 100 },
    { txid: T2, vout: 0, amount: '1200', confirmations: 0, height: null },
    { txid: T2, vout: 1, amount: '300', confirmations: 0, height: null },
    { txid: T3, vout: 1, amount: '5', confirmations: 1, height: 105 },
  ]);
});

test('an address with no history gives an empty list', async () => {
  assert.deepEqual(await explorer(routes([])).addressPayments(ADDR), []);
});

test('an upper-case address still matches', async () => {
  const got = await explorer(routes([mempool(T1, [to(7, ADDR.toUpperCase())])])).addressPayments(ADDR);
  assert.equal(got.length, 1);
});

test('a block newer than the tip counts as one confirmation', async () => {
  const got = await explorer(routes([confirmed(T1, 110, [to(5)])], '105')).addressPayments(ADDR);
  assert.equal(got[0].confirmations, 1);
});

test('zero-value outputs are ignored', async () => {
  assert.deepEqual(await explorer(routes([confirmed(T1, 100, [to(0)])])).addressPayments(ADDR), []);
});

test('the base URL may end with a slash, and the right paths are requested', async () => {
  const calls = [];
  const ex = btcExplorer({ baseUrl: `${BASE}/`, fetchImpl: stub(routes([]), calls) });
  await ex.addressPayments(ADDR);
  assert.deepEqual(calls, [`${BASE}/address/${ADDR}/txs`, `${BASE}/blocks/tip/height`]);
});

test('an HTTP error is an ExplorerError, never an empty list', async () => {
  const map = { ...routes([]), [`/api/address/${ADDR}/txs`]: { body: 'busy', status: 503 } };
  await assert.rejects(() => explorer(map).addressPayments(ADDR), isExplorerError(/503/));
  const noRoute = {};
  await assert.rejects(() => explorer(noRoute).addressPayments(ADDR), isExplorerError(/404/));
});

test('an answer that is not a JSON list is refused', async () => {
  await assert.rejects(() => explorer(routes('<html>oops</html>')).addressPayments(ADDR), isExplorerError(/invalid JSON/));
  await assert.rejects(() => explorer(routes('{"a":1}')).addressPayments(ADDR), isExplorerError(/unexpected/));
  await assert.rejects(() => explorer(routes('null')).addressPayments(ADDR), isExplorerError(/unexpected/));
});

test('malformed transactions are refused', async () => {
  const bad = [
    { ...confirmed(T1, 100, [to(5)]), txid: 'nope' },
    { txid: T1, vout: [to(5)] },
    { txid: T1, status: { confirmed: 'yes' }, vout: [to(5)] },
    { txid: T1, status: { confirmed: true }, vout: [to(5)] },
    { txid: T1, status: { confirmed: true, block_height: -1 }, vout: [to(5)] },
    { txid: T1, status: { confirmed: false }, vout: 'x' },
    mempool(T1, [null]),
    mempool(T1, [to(-5)]),
    mempool(T1, [to(1.5)]),
    mempool(T1, [to('5')]),
    null,
  ];
  for (const b of bad) {
    await assert.rejects(() => explorer(routes([b])).addressPayments(ADDR), isExplorerError(/malformed/), JSON.stringify(b));
  }
});

test('a bad tip height is refused', async () => {
  for (const tip of ['', 'abc', '-5', '1.5', '<html>']) {
    await assert.rejects(() => explorer(routes([], tip)).addressPayments(ADDR), isExplorerError(/tip height/), tip);
  }
});

test('a network failure is an ExplorerError', async () => {
  const ex = btcExplorer({
    baseUrl: BASE,
    fetchImpl: async () => {
      throw new TypeError('fetch failed');
    },
  });
  await assert.rejects(() => ex.addressPayments(ADDR), isExplorerError(/unreachable: fetch failed/));
});

test('a slow explorer times out', async () => {
  const ex = btcExplorer({
    baseUrl: BASE,
    timeoutMs: 30,
    fetchImpl: (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
  });
  await assert.rejects(() => ex.addressPayments(ADDR), isExplorerError(/timed out after 30 ms/));
});

test('only https explorer URLs are accepted', () => {
  for (const u of ['http://explorer.test/api', '', undefined, 'explorer.test', 'ftp://x']) {
    assert.throws(() => btcExplorer({ baseUrl: u }), /https/, String(u));
  }
});
