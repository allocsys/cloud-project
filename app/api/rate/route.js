import { NextResponse } from 'next/server';
import { rateState, rate } from '@/lib/server/rating';
import { userId, unauthorized } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'private, no-store' };

// { ask, url }: ask is true when this account should be asked now; url is the public review page (empty when none is set).
export async function GET(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  return NextResponse.json(await rateState(id), { headers: NO_STORE });
}

// Body: { stars: 1-5, comment?: text } or { skip: true }.
export async function POST(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  let body = null;
  try {
    body = await req.json();
  } catch {}
  const { status, ...rest } = await rate(id, body);
  return NextResponse.json(rest, { status, headers: NO_STORE });
}
