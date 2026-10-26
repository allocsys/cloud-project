import { NextResponse } from 'next/server';
import { adminEnabled, isAdmin } from '@/lib/server/admin';
import { closeInvoice, gatewayOverview, handleUnmatched, setNetworkPaused } from '@/lib/server/gateway-admin';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (body, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

async function gate(req) {
  if (!adminEnabled()) return json({ ok: false, off: true, error: 'Admin is off. Set ADMIN_TOKEN (12 or more characters) and redeploy.' }, 503);
  if (!(await isAdmin(req))) return json({ ok: false, error: 'Sign in required.' }, 401);
  return null;
}

export async function GET(req) {
  return (await gate(req)) || json(await gatewayOverview());
}

// { close: invoiceId }: close a waiting invoice. { network, paused }: pause or resume a network. Otherwise { network, txid, vout, note }: the payment was returned by hand.
export async function POST(req) {
  const denied = await gate(req);
  if (denied) return denied;
  let body = null;
  try {
    body = await req.json();
  } catch {}
  const r =
    body && typeof body.close === 'string'
      ? await closeInvoice({ id: body.close })
      : body && typeof body.paused === 'boolean'
        ? await setNetworkPaused(body)
        : await handleUnmatched(body);
  return json(r, r.ok ? 200 : r.off ? 503 : 400);
}
