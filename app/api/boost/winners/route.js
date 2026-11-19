import { NextResponse } from 'next/server';
import { recentWinners } from '@/lib/server/boost';
import { guarded } from '@/lib/server/shed';

export const dynamic = 'force-dynamic';
export const GET = guarded(GET_);

// Public (no sign-in): the latest boost wins for the landing page bar, { winners: [{ name, prize, at }] }, empty while boost tickets are off.
// The name is already masked, and nothing else about the account or the draw is sent. The edge holds it for 30 s.
async function GET_() {
  const winners = await recentWinners();
  return NextResponse.json({ winners }, { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' } });
}
