import { NextResponse } from 'next/server';
import { getSettings, saveSettings } from '@/lib/server/account';
import { userId, unauthorized } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'private, no-store' };

export async function GET(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  return NextResponse.json(await getSettings(id), { headers: NO_STORE });
}

// Body: { alerts: { payouts?, withdrawals?, news? } } with true/false values. Answers with the saved settings.
export async function POST(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  let body = null;
  try {
    body = await req.json();
  } catch {}
  const { status, ...rest } = await saveSettings(id, body);
  return NextResponse.json(rest, { status, headers: NO_STORE });
}
