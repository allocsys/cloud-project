import { NextResponse } from 'next/server';
import { getNotifications } from '@/lib/server/account';
import { userId, unauthorized } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  return NextResponse.json(await getNotifications(id), { headers: { 'Cache-Control': 'private, no-store' } });
}
