import { NextResponse } from 'next/server';
import { markAllRead } from '@/lib/server/account';
import { userId, unauthorized } from '@/lib/server/auth';
import { guarded } from '@/lib/server/shed';

export const dynamic = 'force-dynamic';
export const POST = guarded(POST_);

// Marking everything read twice is the same as once, so no idempotency key is needed.
async function POST_(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  return NextResponse.json(await markAllRead(id), { headers: { 'Cache-Control': 'no-store' } });
}
