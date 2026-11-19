import { NextResponse } from 'next/server';
import { getLive } from '@/lib/server/market';
import { minersRunning } from '@/lib/server/network-stats';
import { guarded } from '@/lib/server/shed';

export const dynamic = 'force-dynamic';
export const GET = guarded(GET_);

// The live Bitcoin network for the landing page: price and difficulty (the hash power follows from the difficulty),
// plus the real count of miners running on the service (the dashboard adds its mock base to it).
// The same for everyone, so the edge may cache it. { live: false } when there is no trustworthy reading; the page then shows nothing.
async function GET_() {
  let live = null;
  try {
    live = await getLive();
  } catch {}
  const miners = await minersRunning();
  return NextResponse.json(live ? { live: true, btc: live.btc, difficulty: live.difficulty, miners } : { live: false, miners }, {
    headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120' },
  });
}
