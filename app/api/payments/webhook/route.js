import { NextResponse } from 'next/server';
import { settleOrder } from '@/lib/server/miners';
import { cryptoEnabled, verifyCallback } from '@/lib/server/pay-provider';

export const dynamic = 'force-dynamic';

// Payment callback from the active provider. Only a body with a valid signature is acted on (x-gateway-sig or x-nowpayments-sig).
// Duplicate deliveries are harmless: settleOrder activates an order once.
export async function POST(req) {
  if (!cryptoEnabled()) return NextResponse.json({ ok: false }, { status: 503 });
  const raw = await req.text();
  if (raw.length > 50_000) return NextResponse.json({ ok: false }, { status: 413 });
  const body = verifyCallback(raw, req.headers);
  if (!body) return NextResponse.json({ ok: false, error: 'Bad signature.' }, { status: 401 });
  const { status, ...rest } = await settleOrder(body);
  return NextResponse.json(rest, { status });
}
