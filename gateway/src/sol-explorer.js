// Solana explorer client over JSON-RPC (public nodes or your own). It only reads, and anything unexpected throws ExplorerError:
// a broken answer is never turned into "no payments".
//
// How it works: it lists the newest signatures for the address, then reads each new transaction once (parsed) and works out what the
// address received from the balance changes: native SOL (lamports) and tokens (SPL, by mint and owner). That also covers transfers made
// through other programs. Reading a transaction is cached by signature (it never changes), so a poll only costs two calls once warm.
// Only 'finalized' transactions get confirmations (slots since); a confirmed-but-not-final one shows 0 so it counts as pending.
// Limits: the newest 200 signatures within 4 days. Failed transactions are ignored.
import { rpcClient } from './evm-scanner.js';
import { ExplorerError } from './explorer.js';
import { SOL_TOKENS } from './chains/sol.js';

const SIG = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
const AMOUNT = /^[0-9]{1,38}$/;
const DAY = 86_400_000;
const bad = (what) => new ExplorerError(`rpc returned a malformed ${what}`);

export function solExplorer({ rpc, urls, fetchImpl, tokens = SOL_TOKENS, now = () => Date.now(), sigLimit = 200, maxAgeMs = 4 * DAY, batchSize = 10, cacheMax = 2000 }) {
  const client = rpc ?? rpcClient({ urls, fetchImpl });
  const mints = new Map(Object.entries(tokens).map(([asset, t]) => [t.mint, asset]));
  const cache = new Map();

  const amountOf = (b) => {
    const a = b?.uiTokenAmount?.amount;
    if (typeof a !== 'string' || !AMOUNT.test(a)) throw bad('transaction');
    return BigInt(a);
  };

  // What `address` received in one transaction: [{ vout, asset, amount (string) }].
  function parse(res, address) {
    if (!res || typeof res !== 'object' || !res.meta || !res.transaction?.message) throw bad('transaction');
    if (res.meta.err) return [];
    const keys = res.transaction.message.accountKeys;
    const { preBalances, postBalances } = res.meta;
    if (!Array.isArray(keys) || !Array.isArray(preBalances) || !Array.isArray(postBalances)) throw bad('transaction');
    const out = [];
    const i = keys.findIndex((k) => (typeof k === 'string' ? k : k?.pubkey) === address);
    if (i >= 0) {
      const pre = preBalances[i];
      const post = postBalances[i];
      if (!Number.isSafeInteger(pre) || !Number.isSafeInteger(post)) throw bad('transaction');
      if (post > pre) out.push({ vout: 0, asset: 'sol', amount: String(post - pre) });
    }
    const preT = Array.isArray(res.meta.preTokenBalances) ? res.meta.preTokenBalances : [];
    const postT = Array.isArray(res.meta.postTokenBalances) ? res.meta.postTokenBalances : [];
    for (const p of postT) {
      if (!p || p.owner !== address || !mints.has(p.mint)) continue;
      if (!Number.isInteger(p.accountIndex) || p.accountIndex < 0) throw bad('transaction');
      const was = preT.find((x) => x && x.accountIndex === p.accountIndex);
      const delta = amountOf(p) - (was ? amountOf(was) : 0n);
      if (delta > 0n) out.push({ vout: 1 + p.accountIndex, asset: mints.get(p.mint), amount: delta.toString() });
    }
    return out;
  }

  // Every payment received by `address`, as [{ txid (signature), vout, amount (atomic, string), confirmations, height (slot), asset }].
  async function addressPayments(address) {
    const [sigs, slot] = await client.batch([
      { method: 'getSignaturesForAddress', params: [address, { limit: sigLimit, commitment: 'confirmed' }] },
      { method: 'getSlot', params: [{ commitment: 'confirmed' }] },
    ]);
    if (!Array.isArray(sigs)) throw bad('signature list');
    if (!Number.isSafeInteger(slot)) throw bad('slot');
    const t0 = now();
    const keep = [];
    for (const s of sigs) {
      if (!s || typeof s !== 'object' || !SIG.test(String(s.signature)) || !Number.isSafeInteger(s.slot)) throw bad('signature');
      if (s.err) continue;
      if (Number.isFinite(s.blockTime) && s.blockTime * 1000 < t0 - maxAgeMs) continue;
      keep.push(s);
    }
    const need = keep.filter((s) => !cache.has(s.signature));
    for (let i = 0; i < need.length; i += batchSize) {
      const chunk = need.slice(i, i + batchSize);
      const part = await client.batch(
        chunk.map((s) => ({ method: 'getTransaction', params: [s.signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }] })),
      );
      part.forEach((res, j) => cache.set(chunk[j].signature, parse(res, address)));
      while (cache.size > cacheMax) cache.delete(cache.keys().next().value);
    }
    const out = [];
    for (const s of keep) {
      const finalized = s.confirmationStatus === 'finalized';
      for (const c of cache.get(s.signature) ?? []) {
        out.push({ txid: s.signature, vout: c.vout, amount: c.amount, confirmations: finalized ? Math.max(1, slot - s.slot + 1) : 0, height: s.slot, asset: c.asset });
      }
    }
    return out;
  }

  return { addressPayments };
}
