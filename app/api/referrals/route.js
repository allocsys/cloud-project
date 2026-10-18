import { NextResponse } from 'next/server';
import { getReferral } from '@/lib/server/account';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(getReferral(), { headers: { 'Cache-Control': 'private, no-store' } });
}
