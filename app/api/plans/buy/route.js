import { NextResponse } from 'next/server';
import { readJson } from '@/lib/server/body';
import { buyPlan } from '@/lib/server/miners';
import { userId, unauthorized, reserveAction } from '@/lib/server/auth';
import { guarded } from '@/lib/server/shed';

export const dynamic = 'force-dynamic';
export const POST = guarded(POST_);

async function POST_(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  if (id !== 'demo' && (await reserveAction(`buy:${id}`))) {
    return NextResponse.json({ ok: false, error: 'Too many attempts. Try again in 15 minutes.' }, { status: 429, headers: { 'Cache-Control': 'no-store' } });
  }
  let body;
  try {
    body = await readJson(req);
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }
  const { status, ...rest } = await buyPlan(body, { userId: id, key: req.headers.get('idempotency-key') || undefined });
  return NextResponse.json(rest, { status, headers: { 'Cache-Control': 'no-store' } });
}
