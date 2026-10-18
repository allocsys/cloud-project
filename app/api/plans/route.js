import { NextResponse } from 'next/server';
import { getCatalog } from '@/lib/server/miners';

export const dynamic = 'force-dynamic';

// The catalogue is the same for everyone and changes rarely, so the edge can hold it for 5 minutes
// and serve it stale for an hour while refetching.
export function GET() {
  return NextResponse.json(getCatalog(), {
    headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600' },
  });
}
