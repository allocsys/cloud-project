import { NextResponse } from 'next/server';
import { getNotifications } from '@/lib/server/account';
import { userId, unauthorized } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

export function GET(req) {
  const id = userId(req);
  if (!id) return unauthorized();
  return NextResponse.json(getNotifications(id), { headers: { 'Cache-Control': 'private, no-store' } });
}
