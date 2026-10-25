// TRX and SOL explorer tests. No network and no database: fetch and the RPC are stubs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tronExplorer } from '../src/tron-explorer.js';
import { solExplorer } from '../src/sol-explorer.js';
import { ExplorerError } from '../src/explorer.js';
import { tronHex } from '../src/chains/trx.js';

const isExplorerError = (re) => (e) => e instanceof ExplorerError && re.test(e.message);

// ---------- Tron ----------
const TADDR = 'TVQpr1AFM8qbUT1JRbjL8KJDMuqNvP6AEH';
const TOTHER = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const NOW = 1_700_000_000_000;
const id = (c) => c.repeat(64);
const native = (txID, to, amount, ago, contractRet = 'SUCCESS', type = 'TransferContract') => ({
  txID,
  block_timestamp: NOW - ago,
  ret: [{ contractRet }],
  raw_data: { contract: [{ type, parameter: { value: { to_address: tronHex(to), owner_address: tronHex(TOTHER), amount } } }] },
});
const trc20 = (transaction_id, to, value, ago, address = USDT) => ({
  transaction_id,
  block_timestamp: NOW - ago,
  token_info: { address, decimals: 6, symbol: 'USDT' },
  from: TOTHER,
  to,
  type: 'Transfer',
  value,
});

// routes: { native: { only_unconfirmed: [...], only_confirmed: [...] }, trc20: { ... } }
const tronFetch = (routes, seen = []) => async (url, opts) => {
  const u = new URL(url);
  seen.push({ url, headers: opts?.headers ?? {} });
  const kind = u.pathname.endsWith('/trc20') ? 'trc20' : 'native';
  const state = u.searchParams.get('only_confirmed') ? 'only_confirmed' : 'only_unconfirmed';
  const data = routes[kind]?.[state];
  if (data === 'down') return new Response('no', { status: 500 });
  if (typeof data === 'string') return new Response(data);
  return new Response(JSON.stringify({ success: true, data: data ?? [] }));
};
const tron = (routes, extra = {}) => tronExplorer({ baseUrl: 'https://tron.test', fetchImpl: tronFetch(routes), now: () => NOW, ...extra });

test('tron: reads TRX and USDT payments to the address, confirmed ones aged from block time', async () => {
  const routes = {
    native: {
      only_unconfirmed: [native(id('2'), TADDR, 1_234_567, 3000)],
      only_confirmed: [
        native(id('1'), TADDR, 5_000_000, 60_000),
        native(id('3'), TADDR, 9_000_000, 60_000, 'REVERT'), // failed
        native(id('4'), TADDR, 9_000_000, 60_000, 'SUCCESS', 'TriggerSmartContract'), // not a transfer
        native(id('5'), TOTHER, 9_000_000, 60_000), // someone else
      ],
    },
    trc20: {
      only_confirmed: [
        trc20(id('a'), TADDR, '25000000', 90_000),
        trc20(id('a'), TADDR, '1', 90_000), // second transfer in the same transaction
        trc20(id('b'), TADDR, '7', 90_000, 'TXLAomF7R2rWJvcRMhzwtmJ2RobTmmkxDx'), // other token
        trc20(id('c'), TOTHER, '7', 90_000), // someone else
      ],
    },
  };
  assert.deepEqual(await tron(routes).addressPayments(TADDR), [
    { txid: id('2'), vout: 0, amount: '1234567', confirmations: 0, height: null, asset: 'trx' },
    { txid: id('1'), vout: 0, amount: '5000000', confirmations: 20, height: null, asset: 'trx' },
    { txid: id('a'), vout: 1, amount: '25000000', confirmations: 30, height: null, asset: 'usdt' },
    { txid: id('a'), vout: 2, amount: '1', confirmations: 30, height: null, asset: 'usdt' },
  ]);
});

test('tron: a payment seen both unconfirmed and confirmed is counted once, as confirmed', async () => {
  const routes = {
    native: { only_unconfirmed: [native(id('1'), TADDR, 100, 1000)], only_confirmed: [native(id('1'), TADDR, 100, 60_000)] },
  };
  const got = await tron(routes).addressPayments(TADDR);
  assert.equal(got.length, 1);
  assert.equal(got[0].confirmations, 20);
});

test('tron: sends the API key as a header and never in the URL', async () => {
  const seen = [];
  const ex = tronExplorer({ baseUrl: 'https://tron.test/', apiKey: 'k-123', fetchImpl: tronFetch({}, seen), now: () => NOW });
  await ex.addressPayments(TADDR);
  assert.equal(seen.length, 4); // native and USDT, unconfirmed and confirmed
  assert.ok(seen.every((s) => s.headers['TRON-PRO-API-KEY'] === 'k-123' && !s.url.includes('k-123')));
});

test('tron: a failing or broken answer throws instead of looking like no payments', async () => {
  await assert.rejects(tron({ native: { only_unconfirmed: 'down' } }).addressPayments(TADDR), isExplorerError(/500/));
  await assert.rejects(tron({ native: { only_unconfirmed: 'not json' } }).addressPayments(TADDR), isExplorerError(/invalid JSON/));
  await assert.rejects(tron({ native: { only_unconfirmed: [{ txID: 'bad' }] } }).addressPayments(TADDR), isExplorerError(/malformed/));
  await assert.rejects(tron({ trc20: { only_confirmed: [{ ...trc20(id('a'), TADDR, 'x', 1) }] } }).addressPayments(TADDR), isExplorerError(/malformed/));
  assert.throws(() => tronExplorer({ baseUrl: 'http://tron.test' }), /https/);
});

// ---------- Solana ----------
const SADDR = 'FP3TGUFdi4Ko3fCuw2hy71z1bKV6mnrmoLUZGT8w7UpH';
const SOTHER = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const sig = (c) => c.repeat(88);

const solTxSol = { meta: { err: null, preBalances: [5_000_000_000, 1_000_000], postBalances: [3_999_995_000, 1_001_000_000] }, transaction: { message: { accountKeys: [{ pubkey: SOTHER }, { pubkey: SADDR }] } } };
const solTxToken = {
  meta: {
    err: null,
    preBalances: [1, 1, 1],
    postBalances: [1, 1, 1],
    preTokenBalances: [{ accountIndex: 2, mint: USDC, owner: SADDR, uiTokenAmount: { amount: '2500000' } }],
    postTokenBalances: [
      { accountIndex: 2, mint: USDC, owner: SADDR, uiTokenAmount: { amount: '7500000' } },
      { accountIndex: 1, mint: USDC, owner: SOTHER, uiTokenAmount: { amount: '900' } }, // someone else's account
    ],
  },
  transaction: { message: { accountKeys: [{ pubkey: SOTHER }, { pubkey: SOTHER }, { pubkey: SOTHER }] } },
};
const solTxElsewhere = { meta: { err: null, preBalances: [10], postBalances: [5] }, transaction: { message: { accountKeys: [{ pubkey: SOTHER }] } } };

function solRpc({ sigs, txs, slot = 1040 }) {
  const calls = { getTransaction: 0, batches: 0 };
  return {
    calls,
    batch: async (reqs) => {
      calls.batches++;
      return reqs.map((r) => {
        if (r.method === 'getSignaturesForAddress') return sigs;
        if (r.method === 'getSlot') return slot;
        if (r.method === 'getTransaction') {
          calls.getTransaction++;
          return txs[r.params[0]] ?? null;
        }
        throw new Error(`unexpected ${r.method}`);
      });
    },
  };
}

test('sol: reads SOL and token payments from balance changes; only finalized ones get confirmations', async () => {
  const rpc = solRpc({
    sigs: [
      { signature: sig('2'), slot: 1000, err: null, blockTime: null, confirmationStatus: 'finalized' },
      { signature: sig('3'), slot: 1001, err: null, blockTime: null, confirmationStatus: 'confirmed' },
      { signature: sig('4'), slot: 1002, err: { InstructionError: [0, 'Custom'] }, blockTime: null, confirmationStatus: 'finalized' },
      { signature: sig('5'), slot: 1003, err: null, blockTime: null, confirmationStatus: 'finalized' },
    ],
    txs: { [sig('2')]: solTxSol, [sig('3')]: solTxToken, [sig('5')]: solTxElsewhere },
  });
  const ex = solExplorer({ rpc, now: () => NOW });
  const want = [
    { txid: sig('2'), vout: 0, amount: '1000000000', confirmations: 41, height: 1000, asset: 'sol' },
    { txid: sig('3'), vout: 3, amount: '5000000', confirmations: 0, height: 1001, asset: 'usdc' },
  ];
  assert.deepEqual(await ex.addressPayments(SADDR), want);
  assert.equal(rpc.calls.getTransaction, 3); // the failed one is never read

  // second poll: transactions come from the cache
  assert.deepEqual(await ex.addressPayments(SADDR), want);
  assert.equal(rpc.calls.getTransaction, 3);
});

test('sol: signatures older than the age limit are skipped', async () => {
  const rpc = solRpc({
    sigs: [{ signature: sig('2'), slot: 1, err: null, blockTime: Math.floor((NOW - 10 * 86_400_000) / 1000), confirmationStatus: 'finalized' }],
    txs: {},
  });
  assert.deepEqual(await solExplorer({ rpc, now: () => NOW }).addressPayments(SADDR), []);
  assert.equal(rpc.calls.getTransaction, 0);
});

test('sol: a missing or malformed answer throws instead of looking like no payments', async () => {
  const one = { signature: sig('2'), slot: 1000, err: null, blockTime: null, confirmationStatus: 'finalized' };
  await assert.rejects(solExplorer({ rpc: solRpc({ sigs: [one], txs: {} }), now: () => NOW }).addressPayments(SADDR), isExplorerError(/malformed/));
  await assert.rejects(solExplorer({ rpc: solRpc({ sigs: 'nope', txs: {} }), now: () => NOW }).addressPayments(SADDR), isExplorerError(/malformed/));
  await assert.rejects(solExplorer({ rpc: solRpc({ sigs: [{ signature: 'short', slot: 1 }], txs: {} }), now: () => NOW }).addressPayments(SADDR), isExplorerError(/malformed/));
  assert.throws(() => solExplorer({ urls: ['http://sol.test'] }), /https/);
});

// ---------- Registry ----------
test('TRX and SOL are configured only with a well-formed address', async () => {
  const { CHAINS } = await import('../src/chains/index.js');
  const keep = { t: process.env.PAY_ADDR_TRX, s: process.env.PAY_ADDR_SOL };
  try {
    process.env.PAY_ADDR_TRX = TADDR;
    process.env.PAY_ADDR_SOL = SADDR;
    assert.equal(CHAINS.trx.configured(), true);
    assert.equal(CHAINS.sol.configured(), true);
    assert.equal(CHAINS.trx.address(0), TADDR);
    assert.equal(CHAINS.sol.address(7), SADDR);
    process.env.PAY_ADDR_TRX = 'T123';
    process.env.PAY_ADDR_SOL = '0xd3155961b2C13778345aB8697871C5a2f4b40764';
    assert.equal(CHAINS.trx.configured(), false);
    assert.equal(CHAINS.sol.configured(), false);
    assert.deepEqual(CHAINS.trx.assets, ['trx', 'usdt']);
    assert.deepEqual(CHAINS.sol.assets, ['sol', 'usdt', 'usdc']);
    assert.equal(CHAINS.sol.decimalsOf('sol'), 9);
    assert.equal(CHAINS.sol.decimalsOf('usdc'), 6);
    assert.equal(CHAINS.trx.decimalsOf('usdt'), 6);
  } finally {
    if (keep.t === undefined) delete process.env.PAY_ADDR_TRX;
    else process.env.PAY_ADDR_TRX = keep.t;
    if (keep.s === undefined) delete process.env.PAY_ADDR_SOL;
    else process.env.PAY_ADDR_SOL = keep.s;
  }
});
