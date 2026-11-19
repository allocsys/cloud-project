import { NextResponse } from 'next/server';
import { readJson } from '@/lib/server/body';
import { cancelOrder } from '@/lib/server/miners';
import { userId, unauthorized } from '@/lib/server/auth';
import { guarded } from '@/lib/server/shed';

export const dynamic = 'force-dynamic';
export const POST = guarded(POST_);

async function POST_(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  let body;
  try {
    body = await readJson(req);
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }
  const { status, ...rest } = await cancelOrder(id, body?.id);
  return NextResponse.json(rest, { status, headers: { 'Cache-Control': 'no-store' } });
}
