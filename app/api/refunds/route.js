import { NextResponse } from 'next/server';
import { readJson } from '@/lib/server/body';
import { myRefunds, createRequest } from '@/lib/server/refund-requests';
import { userId, unauthorized } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'private, no-store' };

// { requests: [...your requests], open: { [serial]: last moment you can still ask } }
export async function GET(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  return NextResponse.json(await myRefunds(id), { headers: NO_STORE });
}

// Body: { serial, reason, again?, note? }. The answers are checked on the server (lib/refund-rules.js).
export async function POST(req) {
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
