import { NextResponse } from 'next/server';
import { getDashboard } from '@/lib/server/account';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(getDashboard(), { headers: { 'Cache-Control': 'private, no-store' } });
}
