// Bitcoin explorer client for Esplora-compatible APIs (mempool.space, blockstream.info, or your own electrs).
// It only reads. Every call has a timeout, and anything unexpected throws ExplorerError: a broken answer is never
// turned into "no payments", because the settlement code treats an empty list as the truth.
// Paging: Esplora gives the unconfirmed transactions and the newest 25 confirmed ones. When that page is full of confirmed ones, the next
// pages (/txs/chain/:last_seen) are read too, up to maxPages and not further back than STOP_BLOCKS from the newest, so a busy address
// cannot hide a payment behind a page of other transfers.
export class ExplorerError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'ExplorerError';
  }
}

const TXID = /^[0-9a-f]{64}$/;
const PAGE = 25; // confirmed transactions per Esplora page
const STOP_BLOCKS = 1000; // older than this (from the newest transaction) is history, as in chains/index.js recentConfirmations
const bad = () => new ExplorerError('explorer returned a malformed transaction');

export function btcExplorer({ baseUrl, fetchImpl = fetch, timeoutMs = 10_000, maxPages = 6 }) {
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

  async function txPage(address, lastSeen = '') {
    const body = await getText(`/address/${encodeURIComponent(address)}/txs${lastSeen ? `/chain/${lastSeen}` : ''}`);
    let txs;
    try {
      txs = JSON.parse(body);
    } catch (e) {
      throw new ExplorerError('explorer returned invalid JSON', { cause: e });
    }
    if (!Array.isArray(txs)) throw new ExplorerError('explorer returned an unexpected answer');
    return txs;
  }

  // Every output paying `address`, as [{ txid, vout, amount (satoshi, string), confirmations, height }].
  async function addressPayments(address) {
    let page = await txPage(address);
    const txs = [...page];
    let newest = null;
    for (let n = 1; n < maxPages; n++) {
      const confirmed = page.filter((t) => t?.status?.confirmed === true);
      if (confirmed.length < PAGE) break;
      if (newest === null) newest = Math.max(...confirmed.map((t) => Number(t.status.block_height) || 0));
      const last = confirmed[confirmed.length - 1];
      if (!TXID.test(String(last.txid)) || !Number.isInteger(last.status.block_height)) throw bad();
      if (newest - last.status.block_height > STOP_BLOCKS) break;
      page = await txPage(address, last.txid);
      if (!page.length) break;
      txs.push(...page);
    }
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
