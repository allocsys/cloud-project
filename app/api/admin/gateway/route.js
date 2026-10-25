import { NextResponse } from 'next/server';
import { adminEnabled, isAdmin } from '@/lib/server/admin';
import { gatewayOverview } from '@/lib/server/gateway-admin';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (body, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

export async function GET(req) {
  if (!adminEnabled()) return json({ ok: false, off: true, error: 'Admin is off. Set ADMIN_TOKEN (12 or more characters) and redeploy.' }, 503);
  if (!(await isAdmin(req))) return json({ ok: false, error: 'Sign in required.' }, 401);
  return json(await gatewayOverview());
}
