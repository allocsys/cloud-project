import { NextResponse } from 'next/server';
import { clearNotifications } from '@/lib/server/account';
import { userId, unauthorized } from '@/lib/server/auth';
import { guarded } from '@/lib/server/shed';

export const dynamic = 'force-dynamic';
export const POST = guarded(POST_);

async function POST_(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  return NextResponse.json(await clearNotifications(id), { headers: { 'Cache-Control': 'no-store' } });
}
