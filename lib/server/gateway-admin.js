// The gateway for the admin Gateway tab. Server only: the gateway secret never reaches the browser.
// Never throws: a problem comes back as { ok: false, error } so the tab can show it.
import { gatewayUrlOk } from '@/lib/server/pay-provider';

const NETWORKS = ['btc', 'eth', 'bsc', 'pol', 'trx', 'sol'];

function setup() {
  const url = String(process.env.GATEWAY_URL || '').trim();
  const secret = String(process.env.GATEWAY_API_SECRET || '');
  if (!gatewayUrlOk(url) || secret.length < 16) return null;
  return { base: url.replace(/\/+$/, ''), secret };
}

const OFF = { ok: false, off: true, error: 'The gateway is not set up (GATEWAY_URL and GATEWAY_API_SECRET).' };

export async function gatewayOverview() {
  const g = setup();
  if (!g) return OFF;
  try {
    const res = await fetch(`${g.base}/v1/admin/overview`, {
      headers: { authorization: `Bearer ${g.secret}` },
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j?.ok) return { ok: false, error: `The gateway answered ${res.status}.` };
    return j;
  } catch {
    return { ok: false, error: 'The gateway cannot be reached.' };
  }
}

// Marks one unmatched payment as handled (the money was returned by hand). { network, txid, vout, note }.
export async function handleUnmatched(input) {
  const network = typeof input?.network === 'string' ? input.network : '';
  const txid = typeof input?.txid === 'string' ? input.txid.trim() : '';
  const vout = input?.vout;
  const note = typeof input?.note === 'string' ? input.note.trim() : '';
  if (!NETWORKS.includes(network) || !txid || txid.length > 128 || !Number.isInteger(vout) || vout < 0) return { ok: false, error: 'Invalid request.' };
  if (note.length > 80) return { ok: false, error: 'The note is too long (80 characters at most).' };
  const g = setup();
  if (!g) return OFF;
  try {
    const res = await fetch(`${g.base}/v1/admin/unmatched/handle`, {
      method: 'POST',
      headers: { authorization: `Bearer ${g.secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ network, txid, vout, note }),
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });
    const j = await res.json().catch(() => null);
    if (res.status === 404) return { ok: false, error: 'Not found. It may be handled already.' };
    if (!res.ok || !j?.ok) return { ok: false, error: `The gateway answered ${res.status}.` };
    return { ok: true };
  } catch {
    return { ok: false, error: 'The gateway cannot be reached.' };
  }
}
