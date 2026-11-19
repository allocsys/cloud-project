import { NextResponse } from 'next/server';
import { getDashboard } from '@/lib/server/account';
import { userId, unauthorized } from '@/lib/server/auth';
import { guarded } from '@/lib/server/shed';

export const dynamic = 'force-dynamic';
export const GET = guarded(GET_);

async function GET_(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  return NextResponse.json(await getDashboard(id), { headers: { 'Cache-Control': 'private, no-store' } });
}
