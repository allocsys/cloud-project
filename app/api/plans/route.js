import { NextResponse } from 'next/server';
import { getCatalog } from '@/lib/server/miners';
import { getMarket } from '@/lib/server/market';
import { liveBest } from '@/lib/smart';
import { smartSettings } from '@/lib/server/smart-admin';

export const dynamic = 'force-dynamic';

// The catalogue is the same for everyone and admins can edit it, so the edge holds it only briefly.
// `live` is the market the daily estimates are worked out from ({ gross, btc }), or null when there is none.
// `smart` is the coin Smart Mining is on today and how it pays against the reference ({ coin, ratio }), or null when there is no data.
export async function GET() {
  const [{ live, smart }, st] = await Promise.all([getMarket(), smartSettings()]);
  const best = liveBest(smart);
  return NextResponse.json(
    {
      ...getCatalog(),
      live: live ? { gross: live.gross, btc: live.btc } : null,
      smart: best ? { coin: best.coin, ratio: Math.round(best.ratio * 10000) / 10000 } : null,
      smartOn: st.enabled,
      smartPayout: st.payout,
    },
    { headers: { 'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30' } },
  );
}
