import { NextResponse } from 'next/server';
import { clearSession } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

export function POST() {
  return clearSession(NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } }));
}
