import { NextResponse } from 'next/server';
import { getWallet } from '@/lib/server/wallet';

export const dynamic = 'force-dynamic';

// Per-user data: never cached by the network, the browser keeps its own stale-while-revalidate copy.
export function GET() {
  return NextResponse.json(getWallet(), { headers: { 'Cache-Control': 'private, no-store' } });
}
