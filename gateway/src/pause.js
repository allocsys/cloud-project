// Paused networks. A person pauses a network from the admin Gateway tab when it is not in use: it then takes no new invoices, the
// watcher skips it and its block scanner stops calling the node. The flag lives in the gateway database (table paused_networks),
// so every replica sees it and it survives a restart. Changing it is admin-api.js setNetworkPaused().
import { q } from './db.js';

export async function pausedNetworks() {
  return new Set((await q('SELECT network FROM paused_networks')).rows.map((r) => r.network));
}

export async function isPaused(network) {
  return (await q('SELECT 1 FROM paused_networks WHERE network = $1', [network])).rows.length > 0;
}
