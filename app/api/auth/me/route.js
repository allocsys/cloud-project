import { NextResponse } from 'next/server';
import { userId, whoami, unauthorized } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  return NextResponse.json(await whoami(id), { headers: { 'Cache-Control': 'private, no-store' } });
}
