import { NextResponse } from 'next/server';
import { cancelOrder } from '@/lib/server/miners';
import { userId, unauthorized } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }
  const { status, ...rest } = await cancelOrder(id, body?.id);
  return NextResponse.json(rest, { status, headers: { 'Cache-Control': 'no-store' } });
}
