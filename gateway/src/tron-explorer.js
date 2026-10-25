// Tron explorer client for the TronGrid HTTP API (or any compatible node). It only reads. Every call has a timeout, and anything
// unexpected throws ExplorerError: a broken answer is never turned into "no payments", because settlement treats an empty list as truth.
//
// How it works: for native TRX and each allowed TRC20 token it asks twice, for unconfirmed and for confirmed transfers TO the address.
// 'Confirmed' on Tron means solidified (irreversible), so a confirmed payment gets confirmations from its age (3 second blocks, at least 1)
// and an unconfirmed one gets 0. Unconfirmed is asked first, so a payment moving between the two calls is never missed.
// Limits: the newest 200 transfers of the last 30 days per call. TRC20 answers carry no log index, so a second transfer inside one
// transaction gets the next vout. Internal TRX transfers (made by contracts) are not seen.
import { ExplorerError } from './explorer.js';
import { tronHex, TRX_TOKENS } from './chains/trx.js';

const TXID = /^[0-9a-f]{64}$/;
const AMOUNT = /^[0-9]{1,38}$/;
const BLOCK_MS = 3000;
const DAY = 86_400_000;
const bad = () => new ExplorerError('explorer returned a malformed transaction');

export function tronExplorer({ baseUrl, apiKey = '', tokens = TRX_TOKENS, fetchImpl = fetch, timeoutMs = 10_000, now = () => Date.now(), lookbackMs = 30 * DAY, limit = 200 }) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\/[^\s/]+/.test(base)) throw new Error('TRON_API_URL must be an https URL.');

  async function list(path) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(new DOMException('timed out', 'TimeoutError')), timeoutMs);
    try {
      const res = await fetchImpl(base + path, { signal: ctl.signal, headers: apiKey ? { 'TRON-PRO-API-KEY': apiKey } : {} });
      if (!res.ok) throw new ExplorerError(`explorer answered ${res.status}`);
      let body;
      try {
        body = JSON.parse(await res.text());
      } catch (e) {
        throw new ExplorerError('explorer returned invalid JSON', { cause: e });
      }
      if (!body || body.success === false || !Array.isArray(body.data)) throw new ExplorerError('explorer returned an unexpected answer');
      return body.data;
    } catch (e) {
      if (e instanceof ExplorerError) throw e;
      const msg = e?.name === 'TimeoutError' ? `explorer timed out after ${timeoutMs} ms` : 'explorer unreachable';
      throw new ExplorerError(msg, { cause: e });
    } finally {
      clearTimeout(timer);
    }
  }

  // Every TRX and token transfer paying `address`, as [{ txid, vout, amount (sun, string), confirmations, height: null, asset }].
  async function addressPayments(address) {
    const addr = String(address);
    const want = tronHex(addr);
    const t0 = now();
    const out = new Map();
    for (const state of ['only_unconfirmed', 'only_confirmed']) {
      const confirmed = state === 'only_confirmed';
      const age = (ts) => (confirmed ? Math.max(1, Math.floor((t0 - ts) / BLOCK_MS)) : 0);
      const q = `only_to=true&${state}=true&limit=${limit}&min_timestamp=${t0 - lookbackMs}`;

      for (const t of await list(`/v1/accounts/${encodeURIComponent(addr)}/transactions?${q}`)) {
        if (!t || typeof t !== 'object' || !TXID.test(String(t.txID)) || !Number.isSafeInteger(t.block_timestamp ?? 0)) throw bad();
        const c = t.raw_data?.contract;
        if (!Array.isArray(c) || c.length !== 1) throw bad();
        if (c[0]?.type !== 'TransferContract' || t.ret?.[0]?.contractRet !== 'SUCCESS') continue;
        const v = c[0].parameter?.value;
        if (!v || typeof v.to_address !== 'string') throw bad();
        if (v.to_address.toLowerCase() !== want) continue;
        if (!Number.isSafeInteger(v.amount) || v.amount < 0) throw bad();
        if (v.amount === 0) continue;
        out.set(`${t.txID}:0`, { txid: t.txID, vout: 0, amount: String(v.amount), confirmations: age(t.block_timestamp ?? t0), height: null, asset: 'trx' });
      }

      for (const [asset, tok] of Object.entries(tokens)) {
        const seen = new Map();
        for (const t of await list(`/v1/accounts/${encodeURIComponent(addr)}/transactions/trc20?${q}&contract_address=${encodeURIComponent(tok.contract)}`)) {
          if (!t || typeof t !== 'object' || !TXID.test(String(t.transaction_id)) || !Number.isSafeInteger(t.block_timestamp ?? 0)) throw bad();
          if (t.token_info?.address !== tok.contract || t.to !== addr || t.type !== 'Transfer') continue;
          if (typeof t.value !== 'string' || !AMOUNT.test(t.value)) throw bad();
          if (/^0+$/.test(t.value)) continue;
          const n = (seen.get(t.transaction_id) ?? 0) + 1;
          seen.set(t.transaction_id, n);
          out.set(`${t.transaction_id}:${n}`, { txid: t.transaction_id, vout: n, amount: t.value.replace(/^0+/, ''), confirmations: age(t.block_timestamp ?? t0), height: null, asset });
        }
      }
    }
    return [...out.values()];
  }

  return { addressPayments };
}
