import { NextResponse } from 'next/server';
import { getOrders } from '@/lib/server/miners';
import { userId, unauthorized } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  const kind = new URL(req.url).searchParams.get('kind') === 'deposit' ? 'deposit' : 'plan';
  return NextResponse.json(await getOrders(id, kind), { headers: { 'Cache-Control': 'private, no-store' } });
}
