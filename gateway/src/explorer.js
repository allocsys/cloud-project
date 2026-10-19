// Bitcoin explorer client for Esplora-compatible APIs (mempool.space, blockstream.info, or your own electrs).
// It only reads. Every call has a timeout, and anything unexpected throws ExplorerError: a broken answer is never
// turned into "no payments", because the settlement code treats an empty list as the truth.
// Limit: one page of an address's history (about 50 transactions) is read. Invoice addresses are single use, so that is plenty.
export class ExplorerError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'ExplorerError';
  }
}

const TXID = /^[0-9a-f]{64}$/;
const bad = () => new ExplorerError('explorer returned a malformed transaction');

export function btcExplorer({ baseUrl, fetchImpl = fetch, timeoutMs = 10_000 }) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\/[^\s/]+/.test(base)) throw new Error('BTC_EXPLORER_URL must be an https URL.');

  async function getText(path) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(new DOMException('timed out', 'TimeoutError')), timeoutMs);
    try {
      const res = await fetchImpl(base + path, { signal: ctl.signal });
      if (!res.ok) throw new ExplorerError(`explorer answered ${res.status}`);
      return await res.text(); // the timer still covers reading the body
    } catch (e) {
      if (e instanceof ExplorerError) throw e;
      const msg = e?.name === 'TimeoutError' ? `explorer timed out after ${timeoutMs} ms` : `explorer unreachable: ${e?.message}`;
      throw new ExplorerError(msg, { cause: e });
    } finally {
      clearTimeout(timer);
    }
  }

  async function tipHeight() {
    const text = (await getText('/blocks/tip/height')).trim();
    if (!/^[0-9]{1,9}$/.test(text)) throw new ExplorerError('explorer returned an invalid tip height');
    return Number(text);
  }

  // Every output paying `address`, as [{ txid, vout, amount (satoshi, string), confirmations, height }].
  async function addressPayments(address) {
    const body = await getText(`/address/${encodeURIComponent(address)}/txs`);
    let txs;
    try {
      txs = JSON.parse(body);
    } catch (e) {
      throw new ExplorerError('explorer returned invalid JSON', { cause: e });
    }
    if (!Array.isArray(txs)) throw new ExplorerError('explorer returned an unexpected answer');
    const tip = await tipHeight(); // read after the transactions, so a block they are in is never newer than the tip
    const want = String(address).toLowerCase();
    const out = [];
    for (const t of txs) {
      if (!t || typeof t !== 'object' || !TXID.test(String(t.txid)) || !Array.isArray(t.vout)) throw bad();
      if (!t.status || typeof t.status.confirmed !== 'boolean') throw bad();
      let confirmations = 0;
      let height = null;
      if (t.status.confirmed) {
        if (!Number.isInteger(t.status.block_height) || t.status.block_height < 0) throw bad();
        height = t.status.block_height;
        confirmations = Math.max(1, tip - height + 1);
      }
      for (let vout = 0; vout < t.vout.length; vout++) {
        const o = t.vout[vout];
        if (!o || typeof o !== 'object') throw bad();
        if (typeof o.scriptpubkey_address !== 'string' || o.scriptpubkey_address.toLowerCase() !== want) continue;
        if (!Number.isSafeInteger(o.value) || o.value < 0) throw bad();
        if (o.value === 0) continue;
        out.push({ txid: t.txid, vout, amount: String(o.value), confirmations, height });
      }
    }
    return out;
  }

  return { addressPayments, tipHeight };
}
