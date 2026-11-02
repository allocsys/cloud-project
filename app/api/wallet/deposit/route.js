import { NextResponse } from 'next/server';
import { readJson } from '@/lib/server/body';
import { startDeposit } from '@/lib/server/miners';
import { userId, unauthorized, reserveAcct } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

// Starts a wallet top-up through the crypto provider: { usd }. Answers with the pending order and its payment link.
export async function POST(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  // A person starts a few top-ups at most; a script that floods the provider with pending orders is stopped here.
  if (id !== 'demo' && (await reserveAcct(`dep:${id}`))) {
    return NextResponse.json({ ok: false, error: 'Too many attempts. Try again in 15 minutes.' }, { status: 429, headers: { 'Cache-Control': 'no-store' } });
  }
  let body;
  try {
    body = await readJson(req);
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }
  const { status, ...rest } = await startDeposit(body, { userId: id, key: req.headers.get('idempotency-key') || undefined });
  return NextResponse.json(rest, { status, headers: { 'Cache-Control': 'no-store' } });
}
