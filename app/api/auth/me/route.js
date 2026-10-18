import { NextResponse } from 'next/server';
import { userId, whoami, unauthorized } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

export function GET(req) {
  const id = userId(req);
  if (!id) return unauthorized();
  return NextResponse.json(whoami(id), { headers: { 'Cache-Control': 'private, no-store' } });
}
