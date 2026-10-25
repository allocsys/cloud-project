// The payment watcher: on a timer it asks the chain about every open order invoice and feeds the answer to settle.observe().
// Invoices that share an address (fixed-address mode) are looked up ONCE per address; each invoice then keeps only the payments
// that match its asset and exact amount, and payments nobody claimed are kept aside (settle.recordUnmatched).
// Failure policy (one retry layer only): a failed lookup changes NOTHING for that invoice and is logged; the next tick is the retry.
// After a tick with failures the delay doubles (up to 5 minutes) so a sick explorer is not hammered; a clean tick resets it.
// Several replicas may run this at once: observe() locks the invoice row and is idempotent, so that is safe (just redundant).
import { openInvoices, observe, paymentsFor, recordUnmatched } from './settle.js';

const note = (log, level, msg, data) => log[level](JSON.stringify({ level, msg, ...data }));

// explorers: { <network>: { addressPayments(address, { assets }) } }. Invoices on a network without an explorer are skipped.
export async function pollOnce({ explorers, now, log = console }) {
  const out = { checked: 0, failures: [], settled: [] };
  const groups = new Map();
  for (const inv of await openInvoices()) {
    const ex = Object.hasOwn(explorers, inv.network) ? explorers[inv.network] : null;
    if (!ex) continue;
    const key = `${inv.network}|${inv.address}`;
    if (!groups.has(key)) groups.set(key, { ex, invs: [] });
    groups.get(key).invs.push(inv);
  }
  for (const g of groups.values()) {
    const first = g.invs[0];
    out.checked += g.invs.length;
    let seen;
    try {
      seen = await g.ex.addressPayments(first.address, { assets: [...new Set(g.invs.map((i) => i.asset))] });
    } catch (e) {
      for (const inv of g.invs) {
        out.failures.push({ id: inv.id, error: e.message });
        note(log, 'error', 'watcher.lookup_failed', { invoice: inv.id, network: inv.network, error: e.message });
      }
      continue;
    }
    const claimed = new Set();
    for (const inv of g.invs) {
      try {
        for (const t of paymentsFor(inv, seen)) claimed.add(`${t.txid}:${t.vout}`);
        const r = await observe(inv.id, seen, now);
        if (r.queued) {
          out.settled.push({ id: inv.id, status: r.status, queued: r.queued });
          note(log, 'info', 'watcher.settled', { invoice: inv.id, status: r.status, event: r.queued });
        }
      } catch (e) {
        out.failures.push({ id: inv.id, error: e.message });
        note(log, 'error', 'watcher.observe_failed', { invoice: inv.id, network: inv.network, error: e.message });
      }
    }
    if (first.match_amount) {
      try {
        const n = await recordUnmatched({ network: first.network, address: first.address, defaultAsset: first.asset, payments: seen, claimed });
        if (n) note(log, 'info', 'watcher.unmatched', { network: first.network, address: first.address, added: n });
      } catch (e) {
        note(log, 'error', 'watcher.unmatched_failed', { network: first.network, error: e.message });
      }
    }
  }
  return out;
}

// Starts the loop. Returns stop(), which waits for a tick in progress to finish.
export function startWatcher({ explorers, intervalMs, maxBackoffMs = 300_000, log = console }) {
  let stopped = false;
  let timer = null;
  let running = Promise.resolve();
  let failedTicks = 0;

  const schedule = () => {
    if (stopped) return;
    const delay = Math.min(intervalMs * 2 ** failedTicks, Math.max(maxBackoffMs, intervalMs));
    timer = setTimeout(tick, delay);
    timer.unref?.();
  };

  async function tick() {
    running = (async () => {
      try {
        const r = await pollOnce({ explorers, log });
        failedTicks = r.failures.length ? Math.min(failedTicks + 1, 10) : 0;
      } catch (e) {
        failedTicks = Math.min(failedTicks + 1, 10);
        note(log, 'error', 'watcher.tick_failed', { error: e.message });
      }
    })();
    await running;
    schedule();
  }

  timer = setTimeout(tick, 0);
  return async function stop() {
    stopped = true;
    clearTimeout(timer);
    await running;
  };
}
