// TON explorer client for the toncenter v3 HTTP API (or any compatible indexer). It only reads. Every call has a timeout, and anything
// unexpected throws ExplorerError: a broken answer is never turned into "no payments", because settlement treats an empty list as truth.
//
// How it works: one call lists the newest transactions of the address (newest first, last 14 days, up to 100). A transaction counts as a
// payment when it came from another account (not an external message), was not bounced, did not abort or fail, and carries a value to this
// address. Transaction hashes come as base64 and are turned into 64 hex characters (what settlement stores).
// Finality on TON is fast: a transaction already in a masterchain block, or older than 30 seconds, shows 1 confirmation; a younger one 0.
// Limits: the newest 100 transactions within 14 days. Only plain TON transfers (jettons such as USDT are not read).
import { ExplorerError } from './explorer.js';
import { tonParse } from './chains/ton.js';

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

export function tonExplorer({ baseUrl, apiKey = '', fetchImpl = fetch, timeoutMs = 10_000, now = () => Date.now(), lookbackMs = 14 * DAY, limit = 100 }) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\/[^\s/]+/.test(base)) throw new Error('TON_API_URL must be an https URL.');

  async function get(path) {
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
      if (!body || typeof body !== 'object' || !Array.isArray(body.transactions)) throw new ExplorerError('explorer returned an unexpected answer');
      return body.transactions;
    } catch (e) {
      if (e instanceof ExplorerError) throw e;
      const msg = e?.name === 'TimeoutError' ? `explorer timed out after ${timeoutMs} ms` : 'explorer unreachable';
      throw new ExplorerError(msg, { cause: e });
    } finally {
      clearTimeout(timer);
    }
  }

  // Every TON transfer paying `address`, as [{ txid (hex), vout: 0, amount (nanoton, string), confirmations, height (masterchain seqno or null), asset: 'ton' }].
  async function addressPayments(address) {
    const want = tonParse(address);
    const t0 = now();
    const qs = new URLSearchParams({ account: String(address), limit: String(limit), sort: 'desc', start_utime: String(Math.floor((t0 - lookbackMs) / 1000)) });
    const out = [];
    for (const t of await get(`/api/v3/transactions?${qs}`)) {
      if (!t || typeof t !== 'object') throw bad();
      const txid = txHash(t.hash);
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

  return { addressPayments };
}
