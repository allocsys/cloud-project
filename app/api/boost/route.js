import { NextResponse } from 'next/server';
import { getBoosts, buyBoost } from '@/lib/server/boost';
import { userId, unauthorized } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

// Per-user data: never cached by the network, the browser keeps its own stale-while-revalidate copy.
export async function GET(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  return NextResponse.json(await getBoosts(id), { headers: { 'Cache-Control': 'private, no-store' } });
}

// Body: { ticket: 't1' | 't10' | 't100' }. Same Idempotency-Key twice returns the first result instead of buying twice.
export async function POST(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }
  const { status, ...rest } = await buyBoost(body, { userId: id, key: req.headers.get('idempotency-key') || undefined });
  return NextResponse.json(rest, { status, headers: { 'Cache-Control': 'no-store' } });
}
