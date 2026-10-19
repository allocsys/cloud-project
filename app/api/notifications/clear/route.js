import { NextResponse } from 'next/server';
import { clearNotifications } from '@/lib/server/account';
import { userId, unauthorized } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  return NextResponse.json(await clearNotifications(id), { headers: { 'Cache-Control': 'no-store' } });
}
