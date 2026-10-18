import { NextResponse } from 'next/server';
import { markAllRead } from '@/lib/server/account';

export const dynamic = 'force-dynamic';

// Marking everything read twice is the same as once, so no idempotency key is needed.
export function POST() {
  return NextResponse.json(markAllRead(), { headers: { 'Cache-Control': 'no-store' } });
}
