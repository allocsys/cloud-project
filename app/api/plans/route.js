import { NextResponse } from 'next/server';
import { getCatalog } from '@/lib/server/miners';
import { getMarket } from '@/lib/server/market';
import { liveBest } from '@/lib/smart';
import { smartSettings } from '@/lib/server/smart-admin';
import { guardSettings } from '@/lib/server/guard';
import { refreshPricing, pricingGross } from '@/lib/server/pricing';
import { PRICE_BUFFER } from '@/lib/pricing';
import { boostSettings } from '@/lib/server/boost';
import { BOOST, TICKETS, boostOn } from '@/lib/boost';

export const dynamic = 'force-dynamic';

// The catalogue is the same for everyone and admins can edit it, so the edge holds it only briefly.
// `live` is the market the daily estimates are worked out from ({ gross, btc }), or null when there is none.
// `smart` is the coin Smart Mining is on today and how it pays against the reference ({ coin, ratio }), or null when there is no data.
// `halls[].net` is already the live-linked rate buyers pay (see lib/pricing.js); `priced` says whether that is in effect
// (the saved rates are used until the first live reading).
// `smartTable` is the pay table for new Smart Mining purchases ({ rates, bonus }, lib/smart.js smartPayout).
// `pauseRule` is what a day the profit guard pauses does to a miner bought now: 'extend' (the term moves back a day) or 'zero'
// (the day counts and pays nothing). It is fixed on the miner at purchase.
// `boost` is the ticket table for the landing page ({ hours, tickets: [{ id, price, th, pay, prize, chance }] }), or null while boost tickets are off.
export async function GET() {
  const [{ live, smart }, st, guard, bcfg] = await Promise.all([getMarket(), smartSettings(), guardSettings(), boostSettings(), refreshPricing()]);
  const best = liveBest(smart);
  return NextResponse.json(
    {
      ...getCatalog(),
      live: live ? { gross: live.gross, btc: live.btc } : null,
      priced: pricingGross() ? { buffer: PRICE_BUFFER } : null,
      smart: best ? { coin: best.coin, ratio: Math.round(best.ratio * 10000) / 10000 } : null,
      smartOn: st.enabled,
      smartTable: st.table,
      pauseRule: guard.mode,
      boost: boostOn(bcfg)
        ? { hours: BOOST.hours, tickets: TICKETS.map((t) => ({ id: t.id, price: t.price, th: t.th, pay: t.pay, prize: t.prize, coin: t.coin, chance: bcfg.chance[t.id] })) }
        : null,
    },
    { headers: { 'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30' } },
  );
}
