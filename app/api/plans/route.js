import { NextResponse } from 'next/server';
import { getCatalog } from '@/lib/server/miners';
import { getMarket } from '@/lib/server/market';

export const dynamic = 'force-dynamic';

// The catalogue is the same for everyone and admins can edit it, so the edge holds it only briefly.
// `live` is the market the daily estimates are worked out from ({ gross, btc }), or null when there is none.
export async function GET() {
  const { live } = await getMarket();
  return NextResponse.json(
    { ...getCatalog(), live: live ? { gross: live.gross, btc: live.btc } : null },
    { headers: { 'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30' } },
  );
}
