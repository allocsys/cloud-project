import { NextResponse } from 'next/server';
import { solTxFor } from '@/lib/server/miners';
import { userId, unauthorized } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

// Connect wallet on Solana: { id (order), from (wallet address) } -> { tx } (unsigned, base64).
export async function POST(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }
  const { status, ...rest } = await solTxFor(id, body?.id, body?.from);
  return NextResponse.json(rest, { status, headers: { 'Cache-Control': 'no-store' } });
}
