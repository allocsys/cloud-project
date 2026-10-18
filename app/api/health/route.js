import { NextResponse } from 'next/server';
import { store } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

// Liveness probe for Docker and hosts. `store` shows where data is kept: postgres or memory.
export function GET() {
  return NextResponse.json({ ok: true, store: store.mode || 'memory' }, { headers: { 'Cache-Control': 'no-store' } });
}
