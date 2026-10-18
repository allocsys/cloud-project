import { NextResponse } from 'next/server';
import { clearNotifications } from '@/lib/server/account';
import { userId, unauthorized } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

export function POST(req) {
  const id = userId(req);
  if (!id) return unauthorized();
  return NextResponse.json(clearNotifications(id), { headers: { 'Cache-Control': 'no-store' } });
}
