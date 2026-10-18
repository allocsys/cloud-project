import { NextResponse } from 'next/server';
import { clearNotifications } from '@/lib/server/account';

export const dynamic = 'force-dynamic';

export function POST() {
  return NextResponse.json(clearNotifications(), { headers: { 'Cache-Control': 'no-store' } });
}
