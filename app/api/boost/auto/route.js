import { NextResponse } from 'next/server';
import { readJson } from '@/lib/server/body';
import { setAutoBoost } from '@/lib/server/boost';
import { userId, unauthorized } from '@/lib/server/auth';
import { guarded } from '@/lib/server/shed';

export const dynamic = 'force-dynamic';
export const POST = guarded(POST_);

// Body: { on: true, qty: 1 to 5 } turns auto buy on (that many $1 tickets a day), { on: false } turns it off. Answer: { ok, auto: { available, on, qty, max } }.
async function POST_(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  let body;
  try {
    body = await readJson(req);
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }
  const { status, ...rest } = await setAutoBoost(body, { userId: id });
  return NextResponse.json(rest, { status, headers: { 'Cache-Control': 'no-store' } });
}
