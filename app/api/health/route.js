import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Liveness probe for Docker and hosts. No data, no outbound calls.
export function GET() {
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
