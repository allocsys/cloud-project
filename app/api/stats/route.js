import { NextResponse } from 'next/server';
import { publicStats } from '@/lib/server/stats';

export const dynamic = 'force-dynamic';

// { miners, th }: running miners and their total TH/s, for the landing page counter.
export async function GET() {
  try {
    return NextResponse.json(await publicStats(), { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' } });
  } catch {
    return NextResponse.json({ miners: 0, th: 0 }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  }
}
