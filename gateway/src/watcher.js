// The payment watcher: on a timer it asks the chain about every open order invoice and feeds the answer to settle.observe().
// Invoices that share an address (fixed-address mode) are looked up ONCE per address; each invoice then keeps only the payments
// that match its asset and exact amount, and payments nobody claimed are kept aside (settle.recordUnmatched).
// Failure policy (one retry layer only): a failed lookup changes NOTHING for that invoice and is logged; the next tick is the retry.
// After a tick with failures the delay doubles (up to 5 minutes) so a sick explorer is not hammered; a clean tick resets it.
// Several replicas may run this at once: observe() locks the invoice row and is idempotent, so that is safe (just redundant).
// Ended invoices on their own address (BTC extended key) are looked at again for 14 days by sweepEnded(), so money that comes after expiry,
// cancel or reject is kept aside in the unmatched list instead of going unseen. That sweep never counts as a failed tick (no back-off).
import { openInvoices, observe, paymentsFor, recordUnmatched, endedInvoices } from './settle.js';
import { pausedNetworks } from './pause.js';

const note = (log, level, msg, data) => log[level](JSON.stringify({ level, msg, ...data }));

// explorers: { <network>: { addressPayments(address, { assets }) } }. Invoices on a network without an explorer are skipped.
export async function pollOnce({ explorers, now, log = console }) {
  const out = { checked: 0, failures: [], settled: [] };
  const groups = new Map();
  const paused = await pausedNetworks(); // a paused network is not looked at (none should have open invoices; this is the safety net)
  for (const inv of await openInvoices()) {
    if (paused.has(inv.network)) continue;
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
        // A chain scanner that is still waking or catching up is not a sick explorer: say so quietly and do not back off.
        out.failures.push({ id: inv.id, error: e.message, catchingUp: !!e.catchingUp });
        note(log, e.catchingUp ? 'info' : 'error', 'watcher.lookup_failed', { invoice: inv.id, network: inv.network, error: e.message });
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

// How often an ended invoice's address is looked at again, by how long ago it expired: late money is most likely soon after expiry.
const MIN = 60_000;
const HOUR = 3_600_000;
export function lateEveryMs(ageMs) {
  if (ageMs < 2 * HOUR) return 5 * MIN;
  if (ageMs < 24 * HOUR) return 30 * MIN;
  return 12 * HOUR;
}
const LATE_CAP = 8; // lookups per tick, so a backlog never holds up the open invoices for long
const lastLook = new Map(); // invoice id -> time of its last look. Memory only: after a restart every ended invoice is looked at once more.

// One pass over the ended invoices that are due: any payment to their address that was never counted for an invoice is kept aside
// (recordUnmatched skips what chain_txs already holds). A failed lookup is logged, never retried at once, and never raises.
export async function sweepEnded({ explorers, now = new Date(), log = console, cap = LATE_CAP, looked = lastLook }) {
  const out = { looked: 0, recorded: 0, failures: 0 };
  const paused = await pausedNetworks();
  const list = await endedInvoices(now);
  const live = new Set(list.map((i) => i.id));
  for (const id of [...looked.keys()]) if (!live.has(id)) looked.delete(id);
  for (const inv of list) {
    if (out.looked >= cap) break;
    if (paused.has(inv.network)) continue;
    const ex = Object.hasOwn(explorers, inv.network) ? explorers[inv.network] : null;
    if (!ex) continue;
    const age = Math.max(0, now.getTime() - inv.expires_at.getTime());
    const last = looked.get(inv.id);
    if (last !== undefined && now.getTime() - last < lateEveryMs(age)) continue;
    looked.set(inv.id, now.getTime());
    out.looked++;
    try {
      const seen = await ex.addressPayments(inv.address, { assets: [inv.asset] });
      out.recorded += await recordUnmatched({ network: inv.network, address: inv.address, defaultAsset: inv.asset, payments: seen, claimed: new Set(), invoiceId: inv.id });
    } catch (e) {
      out.failures++;
      note(log, e.catchingUp ? 'info' : 'error', 'watcher.late_lookup_failed', { invoice: inv.id, network: inv.network, error: e.message });
    }
  }
  if (out.recorded) note(log, 'info', 'watcher.late_payment', { added: out.recorded });
  return out;
}

// Starts the loop. Returns stop(), which waits for a tick in progress to finish.
// idleMs: the delay while no invoice is open (default: the normal interval). A new invoice is first looked at within one idle delay.
export function startWatcher({ explorers, intervalMs, idleMs = intervalMs, maxBackoffMs = 300_000, log = console }) {
  let stopped = false;
  let timer = null;
  let running = Promise.resolve();
  let failedTicks = 0;
  let idle = false;

  const schedule = () => {
    if (stopped) return;
    const delay = failedTicks ? Math.min(intervalMs * 2 ** failedTicks, Math.max(maxBackoffMs, intervalMs)) : idle ? Math.max(idleMs, intervalMs) : intervalMs;
    timer = setTimeout(tick, delay);
    timer.unref?.();
  };

  async function tick() {
    running = (async () => {
      try {
        const r = await pollOnce({ explorers, log });
        failedTicks = r.failures.some((f) => !f.catchingUp) ? Math.min(failedTicks + 1, 10) : 0;
        idle = r.checked === 0 && r.failures.length === 0;
      } catch (e) {
        failedTicks = Math.min(failedTicks + 1, 10);
        note(log, 'error', 'watcher.tick_failed', { error: e.message });
      }
      try {
        await sweepEnded({ explorers, log });
      } catch (e) {
        note(log, 'error', 'watcher.sweep_failed', { error: e.message });
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
