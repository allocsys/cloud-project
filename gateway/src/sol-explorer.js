// Solana explorer client over JSON-RPC (public nodes or your own). It only reads, and anything unexpected throws ExplorerError:
// a broken answer is never turned into "no payments".
//
// How it works: it lists the newest signatures for the address AND for the address's token accounts (a token transfer touches only the
// token account, not the owner wallet, so the owner's own list never shows it), then reads each new transaction once (parsed) and works
// out what the address received from the balance changes: native SOL (lamports) and tokens (SPL, by mint and owner). That also covers
// transfers made through other programs. Reading a transaction is cached by signature (it never changes), so a poll only costs a few
// calls once warm. The token accounts of the owner (one lookup per accepted mint) are cached for a minute.
// Paging: a full page of signatures is followed by older pages (before=), up to maxPages and not further back than maxAgeMs, so a busy
// address cannot hide a payment behind a page of dust.
// Only 'finalized' transactions get confirmations (slots since); a confirmed-but-not-final one shows 0 so it counts as pending.
// Limits: the newest sigLimit * maxPages signatures per account within 4 days; at most maxTokenAccounts token accounts. Failed transactions are ignored.
import { rpcClient } from './evm-scanner.js';
import { ExplorerError } from './explorer.js';
import { SOL_TOKENS } from './chains/sol.js';

const SIG = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
const ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const AMOUNT = /^[0-9]{1,38}$/;
const DAY = 86_400_000;
const bad = (what) => new ExplorerError(`rpc returned a malformed ${what}`);

export function solExplorer({
  rpc,
  urls,
  fetchImpl,
  tokens = SOL_TOKENS,
  now = () => Date.now(),
  sigLimit = 200,
  maxPages = 5,
  maxAgeMs = 4 * DAY,
  batchSize = 10,
  cacheMax = 5000,
  accountsTtlMs = 60_000,
  maxTokenAccounts = 10,
}) {
  const client = rpc ?? rpcClient({ urls, fetchImpl });
  const mints = new Map(Object.entries(tokens).map(([asset, t]) => [t.mint, asset]));
  const cache = new Map();
  const owned = new Map(); // owner address -> { at, list } (its token accounts for the accepted mints)

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

  // The token accounts `address` owns for the accepted mints (cached for accountsTtlMs).
  async function tokenAccounts(address) {
    const hit = owned.get(address);
    if (hit && now() - hit.at < accountsTtlMs) return hit.list;
    const res = await client.batch(
      [...mints.keys()].map((mint) => ({ method: 'getTokenAccountsByOwner', params: [address, { mint }, { encoding: 'jsonParsed', commitment: 'confirmed' }] })),
    );
    const list = [];
    for (const r of res) {
      if (!r || !Array.isArray(r.value)) throw bad('token account list');
      for (const a of r.value) {
        if (!a || typeof a.pubkey !== 'string' || !ADDR.test(a.pubkey)) throw bad('token account list');
        if (!list.includes(a.pubkey)) list.push(a.pubkey);
      }
    }
    const kept = list.sort().slice(0, maxTokenAccounts);
    owned.set(address, { at: now(), list: kept });
    return kept;
  }

  const listCall = (account, before) => ({
    method: 'getSignaturesForAddress',
    params: [account, { limit: sigLimit, commitment: 'confirmed', ...(before ? { before } : {}) }],
  });
  const asList = (page) => {
    if (!Array.isArray(page)) throw bad('signature list');
    return page;
  };

  // The first page of one account plus the older pages that are still within the age limit, up to maxPages.
  async function withOlderPages(account, first, t0) {
    let page = asList(first);
    const all = [...page];
    for (let n = 1; n < maxPages; n++) {
      if (page.length < sigLimit) break;
      const last = page[page.length - 1];
      if (!last || typeof last !== 'object' || !SIG.test(String(last.signature))) throw bad('signature');
      if (Number.isFinite(last.blockTime) && last.blockTime * 1000 < t0 - maxAgeMs) break;
      [page] = await client.batch([listCall(account, last.signature)]);
      asList(page);
      if (!page.length) break;
      all.push(...page);
    }
    return all;
  }

  // Every payment received by `address`, as [{ txid (signature), vout, amount (atomic, string), confirmations, height (slot), asset }].
  async function addressPayments(address) {
    const accounts = [address, ...(await tokenAccounts(address))];
    const res = await client.batch([...accounts.map((a) => listCall(a)), { method: 'getSlot', params: [{ commitment: 'confirmed' }] }]);
    const slot = res[accounts.length];
    if (!Number.isSafeInteger(slot)) throw bad('slot');
    const t0 = now();
    const bySig = new Map();
    for (let a = 0; a < accounts.length; a++) {
      for (const s of await withOlderPages(accounts[a], res[a], t0)) {
        if (!s || typeof s !== 'object' || !SIG.test(String(s.signature)) || !Number.isSafeInteger(s.slot)) throw bad('signature');
        if (s.err) continue;
        if (Number.isFinite(s.blockTime) && s.blockTime * 1000 < t0 - maxAgeMs) continue;
        const had = bySig.get(s.signature);
        if (!had || (had.confirmationStatus !== 'finalized' && s.confirmationStatus === 'finalized')) bySig.set(s.signature, s);
      }
    }
    const keep = [...bySig.values()].sort((x, y) => y.slot - x.slot); // newest first, so a big backlog is read from the newest
    const need = keep.filter((s) => !cache.has(s.signature));
    for (let i = 0; i < need.length; i += batchSize) {
      const chunk = need.slice(i, i + batchSize);
      const part = await client.batch(
        chunk.map((s) => ({ method: 'getTransaction', params: [s.signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }] })),
      );
      part.forEach((r, j) => cache.set(chunk[j].signature, parse(r, address)));
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
