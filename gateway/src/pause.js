// Paused and idle networks. A person pauses a network from the admin Gateway tab when it is not in use: it then takes no new invoices,
// the watcher skips it and its block scanner stops calling the node. The flag lives in the gateway database (table paused_networks),
// so every replica sees it and it survives a restart. Changing it is admin-api.js setNetworkPaused().
// A network that is not paused but has no open invoice is idle: its scanner makes no node calls either (see hasOpenInvoices).
import { q } from './db.js';

export async function pausedNetworks() {
  return new Set((await q('SELECT network FROM paused_networks')).rows.map((r) => r.network));
}

export async function isPaused(network) {
  return (await q('SELECT 1 FROM paused_networks WHERE network = $1', [network])).rows.length > 0;
}

// True while an order invoice on the network still needs watching: not paid or finalised yet. The same rule as settle.openInvoices():
// an expired invoice counts until its outcome is queued, so the scanner stays awake long enough to settle it.
export async function hasOpenInvoices(network) {
  const r = await q(
    `SELECT 1 FROM invoices i
     WHERE i.kind = 'order' AND i.network = $1 AND i.status IN ('pending', 'confirming', 'partial')
       AND NOT EXISTS (SELECT 1 FROM webhook_outbox o WHERE o.invoice_id = i.id)
     LIMIT 1`,
    [network],
  );
  return r.rows.length > 0;
}
