import { NextResponse } from 'next/server';
import { adminEnabled, isAdmin } from '@/lib/server/admin';
import { databaseOverview, tableRows } from '@/lib/server/db-admin';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (body, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

async function gate(req) {
  if (!adminEnabled()) return json({ ok: false, off: true, error: 'Admin is off. Set ADMIN_TOKEN (12 or more characters) and redeploy.' }, 503);
  if (!(await isAdmin(req))) return json({ ok: false, error: 'Sign in required.' }, 401);
  return null;
}

// Read only. No table in the address: the overview. ?table=name: the newest rows of that table.
export async function GET(req) {
  const denied = await gate(req);
  if (denied) return denied;
  const table = new URL(req.url).searchParams.get('table');
  const r = table === null ? await databaseOverview() : await tableRows(table);
  return json(r, r.ok ? 200 : 400);
}
