// EVM payment scanner. One scanner per network walks the chain block by block and stores every payment to our receiving address
// in observed_txs: native transfers (from full blocks) and ERC-20 Transfer logs of the allowed token contracts.
// The watcher then reads those rows through evmExplorer(), the same shape the Bitcoin explorer gives.
//
// Safety rules
//  - The cursor (chain_cursors) holds the last block read and its hash. Every new batch must connect to that hash; if it does not,
//    the chain reorganised: rows from the last (confirmations + 2) blocks are dropped and those blocks are read again.
//  - Anything unexpected from a node throws ExplorerError. Nothing is stored from a bad answer, and the next tick retries.
//  - evmExplorer() refuses to answer while the scanner is stale or far behind: an empty answer from a sleeping scanner would expire invoices.
//  - Only plain transfers TO the address are seen. Transfers made inside a contract call (internal transfers) are not.
//  - Several replicas may run this: a per-network advisory lock lets only one scan at a time, and every write is idempotent.
import { q, tx } from './db.js';
import { config } from './config.js';
import { CHAINS } from './chains/index.js';
import { EVM, evmAddress } from './chains/evm.js';
import { ExplorerError } from './explorer.js';

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const HASH = /^0x[0-9a-fA-F]{64}$/;
const HEXNUM = /^0x[0-9a-fA-F]{1,64}$/;
const MAX_ATOMIC = 10n ** 38n;

const bad = (what) => new ExplorerError(`rpc returned a malformed ${what}`);
const hex = (n) => `0x${n.toString(16)}`;
const note = (log, level, msg, data) => log[level](JSON.stringify({ level, msg, ...data }));

function big(v, what) {
  if (typeof v !== 'string' || !HEXNUM.test(v)) throw bad(what);
  return BigInt(v);
}
function num(v, what) {
  const n = Number(big(v, what));
  if (!Number.isSafeInteger(n)) throw bad(what);
  return n;
}

// JSON-RPC over https with several endpoints. A failing endpoint is skipped; the one that worked is tried first next time.
// Error messages never contain the URL (it may carry a key).
export function rpcClient({ urls, fetchImpl = fetch, timeoutMs = 10_000 }) {
  const list = (urls || []).map((u) => String(u).trim().replace(/\/+$/, '')).filter(Boolean);
  if (!list.length || list.some((u) => !/^https:\/\/[^\s/]+/.test(u))) throw new Error('EVM RPC URLs must be https URLs.');
  let first = 0;

  async function post(url, body) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(new DOMException('timed out', 'TimeoutError')), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
      if (!res.ok) throw new ExplorerError(`rpc answered ${res.status}`);
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch (e) {
        throw new ExplorerError('rpc returned invalid JSON', { cause: e });
      }
    } catch (e) {
      if (e instanceof ExplorerError) throw e;
      const msg = e?.name === 'TimeoutError' ? `rpc timed out after ${timeoutMs} ms` : 'rpc unreachable';
      throw new ExplorerError(msg, { cause: e });
    } finally {
      clearTimeout(timer);
    }
  }

  // requests: [{ method, params }]. Returns the results in the same order.
  async function batch(requests) {
    const body = requests.map((r, i) => ({ jsonrpc: '2.0', id: i, method: r.method, params: r.params ?? [] }));
    let last = new ExplorerError('no rpc endpoint answered');
    for (let k = 0; k < list.length; k++) {
      const i = (first + k) % list.length;
      try {
        const raw = await post(list[i], body.length === 1 ? body[0] : body);
        const out = new Array(requests.length).fill(undefined);
        for (const r of Array.isArray(raw) ? raw : [raw]) {
          if (!r || typeof r !== 'object' || !Number.isInteger(r.id) || r.id < 0 || r.id >= requests.length) {
            throw new ExplorerError('rpc returned an unexpected answer');
          }
          if (r.error) throw new ExplorerError(`rpc error: ${String(r.error.message || r.error.code).slice(0, 120)}`);
          out[r.id] = r.result;
        }
        if (out.some((v) => v === undefined)) throw new ExplorerError('rpc answer was incomplete');
        first = i;
        return out;
      } catch (e) {
        last = e instanceof ExplorerError ? e : new ExplorerError('rpc failed', { cause: e });
      }
    }
    throw last;
  }

  const call = async (method, params = []) => (await batch([{ method, params }]))[0];
  return { batch, call };
}

function parseBlock(b, height) {
  if (!b || typeof b !== 'object' || !HASH.test(String(b.hash)) || !HASH.test(String(b.parentHash)) || !Array.isArray(b.transactions)) {
    throw bad('block');
  }
  if (num(b.number, 'block') !== height) throw bad('block');
  return { number: height, hash: b.hash.toLowerCase(), parent: b.parentHash.toLowerCase(), txs: b.transactions };
}

export function evmScanner({ network, native, tokens = {}, address, rpc, confirmations, maxBlocks = 50, batchSize = 20, log = console }) {
  const addr = String(address).toLowerCase();
  const padded = `0x${addr.slice(2).padStart(64, '0')}`;
  const byContract = new Map(Object.entries(tokens).map(([asset, t]) => [t.contract.toLowerCase(), asset]));
  const contracts = [...byContract.keys()];
  const rewind = confirmations + 2;

  // Blocks from..to in order. full = with transaction bodies.
  async function blocks(from, to, full) {
    const reqs = [];
    for (let n = from; n <= to; n++) reqs.push({ method: 'eth_getBlockByNumber', params: [hex(n), full] });
    const out = [];
    for (let i = 0; i < reqs.length; i += batchSize) {
      const part = await rpc.batch(reqs.slice(i, i + batchSize));
      part.forEach((b, j) => out.push(parseBlock(b, from + i + j)));
    }
    return out;
  }

  function nativeIn(block) {
    const out = [];
    for (const t of block.txs) {
      if (!t || typeof t !== 'object') throw bad('transaction');
      if (typeof t.to !== 'string' || t.to.toLowerCase() !== addr) continue;
      const amount = big(t.value, 'transaction');
      if (amount === 0n || amount >= MAX_ATOMIC) continue;
      if (!HASH.test(String(t.hash))) throw bad('transaction');
      out.push({ txid: t.hash.toLowerCase(), vout: 0, asset: native, amount, height: block.number });
    }
    return out;
  }

  async function tokensIn(from, to, byHeight) {
    if (!contracts.length) return [];
    const logs = await rpc.call('eth_getLogs', [{ fromBlock: hex(from), toBlock: hex(to), address: contracts, topics: [TRANSFER_TOPIC, null, padded] }]);
    if (!Array.isArray(logs)) throw bad('log list');
    const out = [];
    for (const l of logs) {
      if (!l || typeof l !== 'object') throw bad('log');
      if (l.removed) continue;
      const asset = byContract.get(String(l.address).toLowerCase());
      if (!asset) continue;
      const t = Array.isArray(l.topics) ? l.topics.map((x) => String(x).toLowerCase()) : [];
      if (t.length !== 3 || t[0] !== TRANSFER_TOPIC || t[2] !== padded) continue;
      const height = num(l.blockNumber, 'log');
      const block = byHeight.get(height);
      if (!block || String(l.blockHash).toLowerCase() !== block.hash) throw new ExplorerError('the chain changed while scanning');
      if (!HASH.test(String(l.transactionHash))) throw bad('log');
      const amount = big(l.data, 'log');
      if (amount === 0n || amount >= MAX_ATOMIC) continue;
      out.push({ txid: l.transactionHash.toLowerCase(), vout: num(l.logIndex, 'log') + 1, asset, amount, height });
    }
    return out;
  }

  // One step. Returns { skipped | started | reorg | scanned, found, more }.
  async function scanOnce() {
    return tx(async (c) => {
      const lock = await c.query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS ok', [`scan:${network}`]);
      if (!lock.rows[0].ok) return { skipped: true };
      const tip = num(await rpc.call('eth_blockNumber'), 'block number');
      const cur = (await c.query('SELECT height, hash FROM chain_cursors WHERE network = $1', [network])).rows[0];
      if (!cur) {
        // First run: payments before this moment are not our business.
        const [b] = await blocks(tip, tip, false);
        await c.query('INSERT INTO chain_cursors (network, height, hash, tip) VALUES ($1, $2, $3, $4) ON CONFLICT (network) DO NOTHING', [network, b.number, b.hash, tip]);
        return { started: true, height: b.number };
      }
      const height = Number(cur.height);
      if (height >= tip) {
        if (height === tip) await c.query('UPDATE chain_cursors SET tip = $2, updated_at = now() WHERE network = $1', [network, tip]);
        return { scanned: 0, found: 0, more: false };
      }
      const to = Math.min(tip, height + maxBlocks);
      const list = await blocks(height + 1, to, true);
      for (let i = 1; i < list.length; i++) {
        if (list[i].parent !== list[i - 1].hash) throw new ExplorerError('rpc returned blocks that do not connect');
      }
      if (list[0].parent !== cur.hash) {
        const back = Math.max(0, height - rewind);
        const [b] = await blocks(back, back, false);
        await c.query('DELETE FROM observed_txs WHERE network = $1 AND block_height > $2', [network, back]);
        await c.query('UPDATE chain_cursors SET height = $2, hash = $3, tip = $4, updated_at = now() WHERE network = $1', [network, back, b.hash, tip]);
        await c.query("INSERT INTO audit_log (actor, action, subject, detail) VALUES ('scanner', 'chain.reorg', $1, $2::jsonb)", [network, JSON.stringify({ from: height, to: back })]);
        return { reorg: true, height: back, more: true };
      }
      const byHeight = new Map(list.map((b) => [b.number, b]));
      const found = [...list.flatMap(nativeIn), ...(await tokensIn(height + 1, to, byHeight))];
      for (const f of found) {
        await c.query(
          `INSERT INTO observed_txs (network, txid, vout, address, asset, amount_atomic, block_height)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (network, txid, vout) DO UPDATE SET block_height = EXCLUDED.block_height`,
          [network, f.txid, f.vout, addr, f.asset, f.amount.toString(), f.height],
        );
      }
      await c.query('UPDATE chain_cursors SET height = $2, hash = $3, tip = $4, updated_at = now() WHERE network = $1', [network, to, list[list.length - 1].hash, tip]);
      if (found.length) note(log, 'info', 'scanner.found', { network, count: found.length, from: height + 1, to });
      return { scanned: to - height, found: found.length, more: to < tip };
    });
  }

  return { network, scanOnce };
}

// What the watcher asks: every payment seen to this address, with confirmations counted from the last block the scanner read.
export function evmExplorer({ network, maxLagBlocks, staleMs = 300_000 }) {
  async function addressPayments(address) {
    const cur = (
      await q('SELECT height, tip, (EXTRACT(EPOCH FROM now() - updated_at) * 1000)::bigint AS age_ms FROM chain_cursors WHERE network = $1', [network])
    ).rows[0];
    if (!cur) throw new ExplorerError('the chain scanner has not started yet');
    if (Number(cur.age_ms) > staleMs) throw new ExplorerError('the chain scanner is not keeping up');
    const height = Number(cur.height);
    if (Number(cur.tip) - height > maxLagBlocks) throw new ExplorerError('the chain scanner is behind');
    const rows = (
      await q(
        `SELECT txid, vout, asset, amount_atomic::text AS amount, block_height FROM observed_txs
         WHERE network = $1 AND address = $2 AND seen_at > now() - interval '30 days'
         ORDER BY block_height, vout`,
        [network, String(address).toLowerCase()],
      )
    ).rows;
    return rows.map((r) => ({
      txid: r.txid,
      vout: r.vout,
      amount: r.amount,
      confirmations: Math.max(1, height - Number(r.block_height) + 1),
      height: Number(r.block_height),
      asset: r.asset,
    }));
  }
  return { addressPayments };
}

// One independent loop per scanner. A failure backs off (up to a minute) without slowing the other chains.
// While a scan hit its block cap it runs again after a second, to catch up.
export function startScanner(scanner, { intervalMs, log = console }) {
  let stopped = false;
  let timer = null;
  let running = Promise.resolve();
  let failed = 0;

  async function tick() {
    let delay = intervalMs;
    running = (async () => {
      try {
        const r = await scanner.scanOnce();
        failed = 0;
        if (r.reorg) note(log, 'info', 'scanner.reorg', { network: scanner.network, height: r.height });
        if (r.more) delay = 1000;
      } catch (e) {
        failed = Math.min(failed + 1, 10);
        delay = Math.min(intervalMs * 2 ** failed, Math.max(60_000, intervalMs));
        note(log, 'error', 'scanner.failed', { network: scanner.network, error: e.message });
      }
    })();
    await running;
    if (stopped) return;
    timer = setTimeout(tick, delay);
    timer.unref?.();
  }

  timer = setTimeout(tick, 0);
  return async function stop() {
    stopped = true;
    clearTimeout(timer);
    await running;
  };
}

// Scanners and explorers for every EVM network that is configured. Throws at boot on a bad RPC URL.
export function buildEvm({ log = console } = {}) {
  const c = config();
  const scanners = [];
  const explorers = {};
  for (const [net, e] of Object.entries(EVM)) {
    if (!CHAINS[net].configured()) continue;
    scanners.push(
      evmScanner({
        network: net,
        native: e.native,
        tokens: e.tokens,
        address: evmAddress(),
        rpc: rpcClient({ urls: c.evm.rpc[net] }),
        confirmations: c.evm.confirmations[net],
        maxBlocks: e.maxBlocks,
        log,
      }),
    );
    explorers[net] = evmExplorer({ network: net, maxLagBlocks: e.maxLag });
  }
  return { scanners, explorers };
}
