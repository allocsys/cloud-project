import { NextResponse } from 'next/server';
import { readCapped } from '@/lib/server/body';
import { settleOrder } from '@/lib/server/miners';
import { callbacksEnabled, verifyCallback } from '@/lib/server/pay-provider';

export const dynamic = 'force-dynamic';

// Payment callback from either provider. Only a body with a valid signature is acted on (x-gateway-sig or x-nowpayments-sig).
// It does not matter which provider is in use now: an order opened before a switch still settles.
// Duplicate deliveries are harmless: settleOrder activates an order once.
export async function POST(req) {
  if (!callbacksEnabled()) return NextResponse.json({ ok: false }, { status: 503 });
  const buf = await readCapped(req, 50_000);
  if (buf === null) return NextResponse.json({ ok: false }, { status: 413 });
  const raw = buf.toString('utf8');
  const body = verifyCallback(raw, req.headers);
  if (!body) return NextResponse.json({ ok: false, error: 'Bad signature.' }, { status: 401 });
  const { status, ...rest } = await settleOrder(body);
  return NextResponse.json(rest, { status });
}
