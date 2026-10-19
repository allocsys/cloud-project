import { NextResponse } from 'next/server';
import { q } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

// Liveness and readiness probe for Docker and hosts: 200 only when the database answers.
export async function GET() {
  try {
    await q('SELECT 1');
    return NextResponse.json({ ok: true, store: 'postgres' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ ok: false, store: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
