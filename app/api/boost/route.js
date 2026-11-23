import { NextResponse } from 'next/server';
import { readJson } from '@/lib/server/body';
import { getBoosts, buyBoost } from '@/lib/server/boost';
import { userId, unauthorized } from '@/lib/server/auth';
import { guarded } from '@/lib/server/shed';

export const dynamic = 'force-dynamic';
export const GET = guarded(GET_);
export const POST = guarded(POST_);

// Per-user data: never cached by the network, the browser keeps its own stale-while-revalidate copy.
async function GET_(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  return NextResponse.json(await getBoosts(id), { headers: { 'Cache-Control': 'private, no-store' } });
}

// Body: { ticket: 't1' | 't10' | 't100', qty?: 1 to 5 (default 1) } or { free: true }. Same Idempotency-Key twice returns the first result instead of buying twice.
async function POST_(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  let body;
  try {
    body = await readJson(req);
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }
  const { status, ...rest } = await buyBoost(body, { userId: id, key: req.headers.get('idempotency-key') || undefined });
  return NextResponse.json(rest, { status, headers: { 'Cache-Control': 'no-store' } });
}
