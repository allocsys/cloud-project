import { NextResponse } from 'next/server';
import { readJson } from '@/lib/server/body';
import { rateState, rate } from '@/lib/server/rating';
import { userId, unauthorized } from '@/lib/server/auth';
import { guarded } from '@/lib/server/shed';

export const dynamic = 'force-dynamic';
export const GET = guarded(GET_);
export const POST = guarded(POST_);
const NO_STORE = { 'Cache-Control': 'private, no-store' };

// { ask, url }: ask is true when this account should be asked now; url is the public review page (empty when none is set).
async function GET_(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  return NextResponse.json(await rateState(id), { headers: NO_STORE });
}

// Body: { stars: 1-5, comment?: text } or { skip: true }.
async function POST_(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  let body = null;
  try {
    body = await readJson(req);
  } catch {}
  const { status, ...rest } = await rate(id, body);
  return NextResponse.json(rest, { status, headers: NO_STORE });
}
