import { NextResponse } from 'next/server';
import { getWallet } from '@/lib/server/wallet';
import { userId, unauthorized } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

// Per-user data: never cached by the network, the browser keeps its own stale-while-revalidate copy.
export function GET(req) {
  const id = userId(req);
  if (!id) return unauthorized();
  return NextResponse.json(getWallet(id), { headers: { 'Cache-Control': 'private, no-store' } });
}
