import { NextResponse } from 'next/server';
import { reviewList } from '@/lib/server/reviews';
import { farmVideos } from '@/lib/server/farm';
import { showDemo } from '@/lib/server/flags';
import { guarded } from '@/lib/server/shed';
import { liveEvent } from '@/lib/server/event';

export const dynamic = 'force-dynamic';
export const GET = guarded(GET_);

// What the landing page reads from the database: the demo switch, the reviews and the farm videos the admin added, and the running deposit bonus event (null when none).
// Public (the page shows all of it to everyone). Each part falls back to empty, as the page did before it asked over HTTP.
async function GET_() {
  const [demo, reviews, farm, event] = await Promise.all([showDemo().catch(() => false), reviewList().catch(() => []), farmVideos().catch(() => []), liveEvent().catch(() => null)]);
  return NextResponse.json({ showDemo: demo, reviews, farm, event }, { headers: { 'Cache-Control': 'no-store' } });
}
