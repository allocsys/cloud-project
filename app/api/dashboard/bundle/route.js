import { NextResponse } from 'next/server';
import { getDashboardBundle } from '@/lib/server/bundle';
import { userId, unauthorized } from '@/lib/server/auth';
import { guarded } from '@/lib/server/shed';
import { liveEvent } from '@/lib/server/event';

export const dynamic = 'force-dynamic';
export const GET = guarded(GET_);

// The dashboard's per-user data in one call (see lib/server/bundle.js). Per-user data: never
// cached by the network, the browser keeps its own stale-while-revalidate copy.
async function GET_(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  const [bundle, event] = await Promise.all([getDashboardBundle(id), liveEvent().catch(() => null)]); // event = the running deposit bonus, or null
  return NextResponse.json({ ...bundle, event }, { headers: { 'Cache-Control': 'private, no-store' } });
}
