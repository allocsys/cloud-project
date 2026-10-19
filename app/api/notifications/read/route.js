import { NextResponse } from 'next/server';
import { markAllRead } from '@/lib/server/account';
import { userId, unauthorized } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

// Marking everything read twice is the same as once, so no idempotency key is needed.
export async function POST(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  return NextResponse.json(await markAllRead(id), { headers: { 'Cache-Control': 'no-store' } });
}
