import { NextResponse } from 'next/server';
import { getPrices } from '@/lib/server/prices';

export const dynamic = 'force-dynamic';

// Prices are the same for everyone, so the edge may cache them: 15 s fresh, then serve stale for a minute
// while it refetches. The server also keeps its own in-memory cache (lib/server/prices.js).
export async function GET() {
  const snap = await getPrices();
  return NextResponse.json(snap, {
    headers: { 'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=60' },
  });
}
