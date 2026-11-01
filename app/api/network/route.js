import { NextResponse } from 'next/server';
import { getLive } from '@/lib/server/market';

export const dynamic = 'force-dynamic';

// The live Bitcoin network for the landing page: price and difficulty (the hash power follows from the difficulty).
// The same for everyone, so the edge may cache it. { live: false } when there is no trustworthy reading; the page then shows nothing.
export async function GET() {
  let live = null;
  try {
    live = await getLive();
  } catch {}
  return NextResponse.json(live ? { live: true, btc: live.btc, difficulty: live.difficulty } : { live: false }, {
    headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120' },
  });
}
