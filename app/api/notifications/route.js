import { NextResponse } from 'next/server';
import { getNotifications } from '@/lib/server/account';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(getNotifications(), { headers: { 'Cache-Control': 'private, no-store' } });
}
