// EVM scanner tests. The chain is a fake and no network is used. The scanner tests use a real Postgres (skipped without DATABASE_URL).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { q, closeDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { evmScanner, evmExplorer, rpcClient } from '../src/evm-scanner.js';
import { ExplorerError } from '../src/explorer.js';

const skip = process.env.DATABASE_URL ? false : 'DATABASE_URL not set';
const run = Math.random().toString(36).slice(2, 8);
const net = `test-evm-${run}`;
const quiet = { error() {}, info() {} };

const ADDR = '0xd3155961b2C13778345aB8697871C5a2f4b40764';
const OTHER = `0x${'1'.repeat(40)}`;
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const pad = (a) => `0x${a.slice(2).toLowerCase().padStart(64, '0')}`;
const hex = (n) => `0x${BigInt(n).toString(16)}`;
const hash = (n, fork = 'a') => `0x${createHash('sha256').update(`${fork}-${n}`).digest('hex')}`;
const txh = (s) => `0x${createHash('sha256').update(`tx-${run}-${s}`).digest('hex')}`;
const mk = (n, fork, parentFork, txs = []) => ({ hash: hash(n, fork), parent: hash(n - 1, parentFork), txs });
const isExplorerError = (re) => (e) => e instanceof ExplorerError && re.test(e.message);

// A tiny chain: state.blocks[height] = { hash, parent, txs }, state.logs = raw log objects, state.tip.
const state = { tip: 0, blocks: {}, logs: [] };
const fakeRpc = () => {
  const batch = async (reqs) =>
    reqs.map((r) => {
      if (r.method === 'eth_blockNumber') return hex(state.tip);
      if (r.method === 'eth_getBlockByNumber') {
        const n = parseInt(r.params[0], 16);
        const b = state.blocks[n];
        return b ? { number: hex(n), hash: b.hash, parentHash: b.parent, transactions: b.txs, timestamp: hex(n * 12) } : null;
      }
      if (r.method === 'eth_getLogs') {
        const lo = parseInt(r.params[0].fromBlock, 16);
        const hi = parseInt(r.params[0].toBlock, 16);
        return state.logs.filter((l) => parseInt(l.blockNumber, 16) >= lo && parseInt(l.blockNumber, 16) <= hi);
      }
      throw new Error(`unexpected ${r.method}`);
    });
  return { batch, call: async (method, params = []) => (await batch([{ method, params }]))[0] };
};
const tokenLog = (block, fork, id, to, amount, index, contract = USDT) => ({
  address: contract,
  topics: [TRANSFER, pad(OTHER), pad(to)],
  data: hex(amount),
  blockNumber: hex(block),
  blockHash: hash(block, fork),
  transactionHash: txh(id),
  logIndex: hex(index),
  removed: false,
});

const scanner = evmScanner({
  network: net,
  native: 'eth',
  tokens: { usdt: { contract: USDT, decimals: 6 } },
  address: ADDR,
  rpc: fakeRpc(),
  confirmations: 1,
  maxBlocks: 50,
  log: quiet,
});
const explorer = evmExplorer({ network: net, maxLagBlocks: 100 });
const cursor = async () => (await q('SELECT height, hash FROM chain_cursors WHERE network = $1', [net])).rows[0];

before(async () => {
  if (!skip) await migrate();
});

after(async () => {
  if (!skip) {
    await q('DELETE FROM observed_txs WHERE network LIKE $1', [`${net}%`]);
    await q('DELETE FROM chain_cursors WHERE network LIKE $1', [`${net}%`]);
  }
  await closeDb();
});

test('the first run starts at the tip and reads nothing before it', { skip }, async () => {
  state.tip = 1000;
  state.blocks = { 1000: mk(1000, 'a', 'a') };
  const r = await scanner.scanOnce();
  assert.equal(r.started, true);
  assert.equal(Number((await cursor()).height), 1000);
});

test('records native and token payments to the address and ignores the rest', { skip }, async () => {
  state.blocks[1001] = mk(1001, 'a', 'a');
  state.blocks[1002] = mk(1002, 'a', 'a', [
    { hash: txh('n1'), to: ADDR, value: hex(10n ** 18n) },
    { hash: txh('x'), to: OTHER, value: '0x1' },
    { hash: txh('z'), to: ADDR, value: '0x0' },
  ]);
  state.blocks[1003] = mk(1003, 'a', 'a');
  state.logs = [
    tokenLog(1003, 'a', 't1', ADDR, 2_500_000, 4),
    tokenLog(1003, 'a', 't2', OTHER, 7_000_000, 5), // to someone else
    tokenLog(1003, 'a', 't3', ADDR, 9_000_000, 6, `0x${'2'.repeat(40)}`), // not an allowed contract
  ];
  state.tip = 1003;
  const r = await scanner.scanOnce();
  assert.equal(r.found, 2);
  assert.equal(r.scanned, 3);
  assert.deepEqual(await explorer.addressPayments(ADDR), [
    { txid: txh('n1'), vout: 0, amount: '1000000000000000000', confirmations: 2, height: 1002, asset: 'eth' },
    { txid: txh('t1'), vout: 5, amount: '2500000', confirmations: 1, height: 1003, asset: 'usdt' },
  ]);
});

test('scanning the same blocks again changes nothing', { skip }, async () => {
  const r = await scanner.scanOnce();
  assert.equal(r.scanned, 0);
  assert.equal((await explorer.addressPayments(ADDR)).length, 2);
});

test('a reorg drops the payments of the removed blocks and reads the new ones', { skip }, async () => {
  state.blocks[1003] = mk(1003, 'b', 'a');
  state.blocks[1004] = mk(1004, 'b', 'b');
  state.logs = []; // the token payment was in the block that is gone
  state.tip = 1004;
  const r = await scanner.scanOnce();
  assert.equal(r.reorg, true);
  assert.equal(r.height, 1000);
  assert.deepEqual(await explorer.addressPayments(ADDR), []);
  const again = await scanner.scanOnce();
  assert.equal(again.found, 1);
  assert.deepEqual(await explorer.addressPayments(ADDR), [
    { txid: txh('n1'), vout: 0, amount: '1000000000000000000', confirmations: 3, height: 1002, asset: 'eth' },
  ]);
  const audit = await q("SELECT 1 FROM audit_log WHERE action = 'chain.reorg' AND subject = $1", [net]);
  assert.equal(audit.rowCount, 1);
});

test('blocks that do not connect are refused and nothing is stored', { skip }, async () => {
  const was = await cursor();
  state.blocks[1005] = mk(1005, 'b', 'b');
  state.blocks[1006] = mk(1006, 'b', 'zzz');
  state.tip = 1006;
  await assert.rejects(scanner.scanOnce(), isExplorerError(/do not connect/));
  assert.equal((await cursor()).height, was.height);
});

test('the explorer refuses to answer when the scanner has not started, is behind, or is stale', { skip }, async () => {
  await assert.rejects(evmExplorer({ network: `${net}-none`, maxLagBlocks: 10 }).addressPayments(ADDR), isExplorerError(/not started/));
  await q('INSERT INTO chain_cursors (network, height, hash, tip) VALUES ($1, 100, $2, 500)', [`${net}-lag`, hash(100)]);
  await assert.rejects(evmExplorer({ network: `${net}-lag`, maxLagBlocks: 10 }).addressPayments(ADDR), isExplorerError(/behind/));
  await q("INSERT INTO chain_cursors (network, height, hash, tip, updated_at) VALUES ($1, 100, $2, 100, now() - interval '1 hour')", [`${net}-old`, hash(100)]);
  await assert.rejects(evmExplorer({ network: `${net}-old`, maxLagBlocks: 10 }).addressPayments(ADDR), isExplorerError(/keeping up/));
});

test('rpc client skips a failing endpoint, remembers the one that worked, and maps answers by id', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push(url);
    if (url.startsWith('https://bad.test')) return new Response('no', { status: 500 });
    const body = JSON.parse(opts.body);
    const list = Array.isArray(body) ? body : [body];
    const out = list.map((r) => ({ jsonrpc: '2.0', id: r.id, result: `r${r.id}` })).reverse();
    return new Response(JSON.stringify(Array.isArray(body) ? out : out[0]));
  };
  const rpc = rpcClient({ urls: ['https://bad.test/x', 'https://good.test/y'], fetchImpl });
  assert.deepEqual(await rpc.batch([{ method: 'a' }, { method: 'b' }]), ['r0', 'r1']);
  assert.deepEqual(calls, ['https://bad.test/x', 'https://good.test/y']);
  assert.equal(await rpc.call('c'), 'r0');
  assert.equal(calls[2], 'https://good.test/y');
});

test('rpc client needs https and never puts the URL in an error', async () => {
  assert.throws(() => rpcClient({ urls: ['http://node.test'] }), /https/);
  assert.throws(() => rpcClient({ urls: [] }), /https/);
  const fetchImpl = async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 0, error: { code: -32000, message: 'range too large' } }));
  const rpc = rpcClient({ urls: ['https://secret-key-node.test/abc123'], fetchImpl });
  await assert.rejects(rpc.call('eth_getLogs'), (e) => e instanceof ExplorerError && /range too large/.test(e.message) && !/abc123/.test(e.message));
});

test('EVM networks are configured only with a well-formed address and when listed', async () => {
  const { CHAINS } = await import('../src/chains/index.js');
  const keep = { a: process.env.PAY_ADDR_EVM, n: process.env.EVM_NETWORKS };
  try {
    delete process.env.EVM_NETWORKS;
    process.env.PAY_ADDR_EVM = ADDR;
    assert.deepEqual(['eth', 'bsc', 'pol'].map((n) => CHAINS[n].configured()), [true, true, true]);
    process.env.EVM_NETWORKS = 'eth';
    assert.deepEqual(['eth', 'bsc', 'pol'].map((n) => CHAINS[n].configured()), [true, false, false]);
    process.env.PAY_ADDR_EVM = '0x123';
    assert.equal(CHAINS.eth.configured(), false);
    assert.deepEqual(CHAINS.bsc.assets, ['bnb', 'usdt', 'usdc']);
    assert.equal(CHAINS.bsc.decimalsOf('usdt'), 18);
    assert.equal(CHAINS.pol.decimalsOf('usdc'), 6);
    assert.equal(CHAINS.eth.decimalsOf('eth'), 18);
  } finally {
    if (keep.a === undefined) delete process.env.PAY_ADDR_EVM;
    else process.env.PAY_ADDR_EVM = keep.a;
    if (keep.n === undefined) delete process.env.EVM_NETWORKS;
    else process.env.EVM_NETWORKS = keep.n;
  }
});

test('wake keeps a recent cursor and moves a stale or missing one back by the catch-up window only', { skip }, async () => {
  const wnet = `${net}-wake`;
  const sc = evmScanner({ network: wnet, native: 'eth', tokens: {}, address: ADDR, rpc: fakeRpc(), confirmations: 1, maxBlocks: 50, log: quiet });
  state.tip = 5000;
  state.blocks = { 4000: mk(4000, 'a', 'a'), 4700: mk(4700, 'a', 'a'), 5000: mk(5000, 'a', 'a') };
  const hour = 3_600_000;
  const height = async () => Number((await q('SELECT height FROM chain_cursors WHERE network = $1', [wnet])).rows[0].height);

  // No cursor. The fake chain makes a block every 12 s, so one hour is 300 blocks.
  const first = await sc.wake(hour);
  assert.equal(first.jumped, true);
  assert.equal(first.from, 4700);
  assert.equal(await height(), 4700);

  // A cursor read a moment ago is kept.
  assert.deepEqual(await sc.wake(hour), { kept: true });
  assert.equal(await height(), 4700);

  // A cursor older than the window jumps forward again instead of reading every block it missed.
  await q("UPDATE chain_cursors SET height = 100, updated_at = now() - interval '2 hours' WHERE network = $1", [wnet]);
  const again = await sc.wake(hour);
  assert.equal(again.from, 4700);
  assert.equal(await height(), 4700);
});

test('a scanner that is not ready says it is catching up, so the watcher does not back off', { skip }, async () => {
  await assert.rejects(evmExplorer({ network: `${net}-never`, maxLagBlocks: 10 }).addressPayments(ADDR), (e) => e instanceof ExplorerError && e.catchingUp === true);
});
