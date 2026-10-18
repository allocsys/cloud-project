import { NextResponse } from 'next/server';
import { getMiners } from '@/lib/server/miners';

export const dynamic = 'force-dynamic';

// Per-user data: never cached by the network, the browser keeps its own stale-while-revalidate copy.
export function GET() {
  return NextResponse.json(getMiners(), { headers: { 'Cache-Control': 'private, no-store' } });
}
