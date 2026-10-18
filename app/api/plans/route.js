import { NextResponse } from 'next/server';
import { getCatalog } from '@/lib/server/miners';

export const dynamic = 'force-dynamic';

// The catalogue is the same for everyone and admins can edit it, so the edge holds it only briefly.
export function GET() {
  return NextResponse.json(getCatalog(), {
    headers: { 'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30' },
  });
}
