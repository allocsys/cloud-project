// TON explorer client for the toncenter v3 HTTP API (or any compatible indexer). It only reads. Every call has a timeout, and anything
// unexpected throws ExplorerError: a broken answer is never turned into "no payments", because settlement treats an empty list as truth.
//
// How it works: a call lists the newest transactions of the address (newest first, last 14 days, 100 per page). A full page is followed
// by the next one (offset), up to maxPages, so dust spam cannot push a real payment out of view. A transaction counts as a
// payment when it came from another account (not an external message), was not bounced, did not abort or fail, and carries a value to this
// address. Transaction hashes come as base64 and are turned into 64 hex characters (what settlement stores).
// Finality on TON is fast: a transaction already in a masterchain block, or older than 30 seconds, shows 1 confirmation; a younger one 0.
// Limits: the newest limit * maxPages transactions within 14 days.
// Tokens (USDT): read only when asked for (options.assets), from /api/v3/jetton/transfers (direction in, filtered by the token's master).
// A transfer counts when its master is the known one (a fake token has another master), it was not aborted and it went to this address.
// Without options.assets only plain TON is read.
import { ExplorerError } from './explorer.js';
import { tonParse, TON_JETTONS } from './chains/ton.js';

const DAY = 86_400_000;
const SETTLE_MS = 30_000;
const AMOUNT = /^[0-9]{1,38}$/;
const bad = () => new ExplorerError('explorer returned a malformed transaction');

// A transaction hash as 64 lower case hex. Hex passes through; base64 or base64url of 32 bytes is converted.
function txHash(h) {
  const s = String(h ?? '');
  if (/^[0-9a-fA-F]{64}$/.test(s)) return s.toLowerCase();
  if (/^[A-Za-z0-9+/_-]{43}=?$/.test(s)) {
    const b = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (b.length === 32) return b.toString('hex');
  }
  throw bad();
}

export function tonExplorer({ baseUrl, apiKey = '', fetchImpl = fetch, timeoutMs = 10_000, now = () => Date.now(), lookbackMs = 14 * DAY, limit = 100, maxPages = 5 }) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\/[^\s/]+/.test(base)) throw new Error('TON_API_URL must be an https URL.');

  async function get(path, key) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(new DOMException('timed out', 'TimeoutError')), timeoutMs);
    try {
      const res = await fetchImpl(base + path, { signal: ctl.signal, headers: apiKey ? { 'X-API-Key': apiKey } : {} });
      if (!res.ok) throw new ExplorerError(`explorer answered ${res.status}`);
      let body;
      try {
        body = JSON.parse(await res.text());
      } catch (e) {
        throw new ExplorerError('explorer returned invalid JSON', { cause: e });
      }
      if (!body || typeof body !== 'object' || !Array.isArray(body[key])) throw new ExplorerError('explorer returned an unexpected answer');
      return body[key];
    } catch (e) {
      if (e instanceof ExplorerError) throw e;
      const msg = e?.name === 'TimeoutError' ? `explorer timed out after ${timeoutMs} ms` : 'explorer unreachable';
      throw new ExplorerError(msg, { cause: e });
    } finally {
      clearTimeout(timer);
    }
  }

  // All pages of one list call (newest first), up to maxPages. A full page is followed by the next one.
  async function list(path, key, params, t0) {
    const start = String(Math.floor((t0 - lookbackMs) / 1000));
    const rows = [];
    for (let n = 0; n < maxPages; n++) {
      const qs = new URLSearchParams({ ...params, limit: String(limit), offset: String(n * limit), sort: 'desc', start_utime: start });
      const page = await get(`${path}?${qs}`, key);
      rows.push(...page);
      if (page.length < limit) break;
    }
    return rows;
  }

  // Every plain TON transfer paying the address, as [{ txid (hex), vout: 0, amount (nanoton, string), confirmations, height (masterchain seqno or null), asset: 'ton' }].
  async function tonPayments(address, want, t0) {
    const txs = await list('/api/v3/transactions', 'transactions', { account: String(address) }, t0);
    const out = [];
    const done = new Set(); // a transaction that arrived between two pages can show up twice
    for (const t of txs) {
      if (!t || typeof t !== 'object') throw bad();
      const txid = txHash(t.hash);
      if (done.has(txid)) continue;
      done.add(txid);
      if (!t.description || typeof t.description !== 'object') throw bad();
      const m = t.in_msg;
      if (!m || typeof m !== 'object') continue; // no incoming message (a tick-tock transaction)
      if (t.emulated === true) continue;
      if (m.source === null || m.source === undefined || m.source === '') continue; // an external message: the wallet sending, not paying us
      if (m.bounced === true) continue;
      if (t.description.aborted === true || t.description.compute_ph?.success === false) continue;
      let to;
      try {
        to = tonParse(m.destination);
      } catch {
        throw bad();
      }
      if (to.workchain !== want.workchain || to.hash !== want.hash) continue;
      let value;
      if (typeof m.value === 'string' && AMOUNT.test(m.value)) value = m.value.replace(/^0+/, '');
      else if (Number.isSafeInteger(m.value) && m.value >= 0) value = String(m.value);
      else throw bad();
      if (value === '') continue;
      if (!Number.isSafeInteger(t.now ?? 0)) throw bad();
      const seqno = Number.isInteger(t.mc_block_seqno) && t.mc_block_seqno > 0 ? t.mc_block_seqno : null;
      const settled = seqno !== null || (t.now ? t0 - t.now * 1000 >= SETTLE_MS : false);
      out.push({ txid, vout: 0, amount: value, confirmations: settled ? 1 : 0, height: seqno, asset: 'ton' });
    }
    return out;
  }

  // Every transfer of one token (a jetton, e.g. usdt) to the address; amount in the token's own units. Same shape, height is null.
  async function jettonPayments(address, want, t0, asset) {
    const { master } = TON_JETTONS[asset];
    const wantMaster = tonParse(master);
    const rows = await list('/api/v3/jetton/transfers', 'jetton_transfers', { owner_address: String(address), jetton_master: master, direction: 'in' }, t0);
    const out = [];
    const done = new Set();
    for (const r of rows) {
      if (!r || typeof r !== 'object') throw bad();
      const txid = txHash(r.transaction_hash);
      if (done.has(txid)) continue;
      done.add(txid);
      let from;
      let to;
      try {
        from = tonParse(r.jetton_master);
        to = tonParse(r.destination);
      } catch {
        throw bad();
      }
      if (from.workchain !== wantMaster.workchain || from.hash !== wantMaster.hash) continue; // another token
      if (to.workchain !== want.workchain || to.hash !== want.hash) continue;
      if (r.transaction_aborted === true) continue;
      let value;
      if (typeof r.amount === 'string' && AMOUNT.test(r.amount)) value = r.amount.replace(/^0+/, '');
      else throw bad();
      if (value === '') continue;
      if (!Number.isSafeInteger(r.transaction_now) || r.transaction_now <= 0) throw bad();
      const settled = t0 - r.transaction_now * 1000 >= SETTLE_MS;
      out.push({ txid, vout: 0, amount: value, confirmations: settled ? 1 : 0, height: null, asset });
    }
    return out;
  }

  // options.assets: which assets to read ('ton' and any token of TON_JETTONS). Default: plain TON only.
  async function addressPayments(address, { assets = ['ton'] } = {}) {
    const want = tonParse(address);
    const t0 = now();
    const out = [];
    if (assets.includes('ton')) out.push(...(await tonPayments(address, want, t0)));
    for (const a of new Set(assets)) if (Object.hasOwn(TON_JETTONS, a)) out.push(...(await jettonPayments(address, want, t0, a)));
    return out;
  }

  return { addressPayments };
}
