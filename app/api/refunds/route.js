import { NextResponse } from 'next/server';
import { readJson } from '@/lib/server/body';
import { myRefunds, createRequest } from '@/lib/server/refund-requests';
import { userId, unauthorized } from '@/lib/server/auth';
import { guarded } from '@/lib/server/shed';

export const dynamic = 'force-dynamic';
export const GET = guarded(GET_);
export const POST = guarded(POST_);
const NO_STORE = { 'Cache-Control': 'private, no-store' };

// { requests: [...your requests], open: { [serial]: last moment you can still ask } }
async function GET_(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  return NextResponse.json(await myRefunds(id), { headers: NO_STORE });
}

// Body: { serial, reason, again?, note? }. The answers are checked on the server (lib/refund-rules.js).
async function POST_(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  let body;
  try {
    body = await readJson(req);
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400, headers: NO_STORE });
  }
  const { status, ...rest } = await createRequest(id, String(body?.serial ?? ''), body);
  return NextResponse.json(rest, { status, headers: NO_STORE });
}
