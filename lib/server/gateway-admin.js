// Read-only view of the gateway for the admin Gateway tab. Server only: the gateway secret never reaches the browser.
// Never throws: a problem comes back as { ok: false, error } so the tab can show it.
import { gatewayUrlOk } from '@/lib/server/pay-provider';

export async function gatewayOverview() {
  const url = String(process.env.GATEWAY_URL || '').trim();
  const secret = String(process.env.GATEWAY_API_SECRET || '');
  if (!gatewayUrlOk(url) || secret.length < 16) {
    return { ok: false, off: true, error: 'The gateway is not set up (GATEWAY_URL and GATEWAY_API_SECRET).' };
  }
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/v1/admin/overview`, {
      headers: { authorization: `Bearer ${secret}` },
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
