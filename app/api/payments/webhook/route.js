import { NextResponse } from 'next/server';
import { settleOrder } from '@/lib/server/miners';
import { cryptoEnabled, verifySig } from '@/lib/server/pay-provider';

export const dynamic = 'force-dynamic';

// Payment callback from NOWPayments. Only a body with a valid x-nowpayments-sig is acted on.
export async function POST(req) {
  if (!cryptoEnabled()) return NextResponse.json({ ok: false }, { status: 503 });
  const raw = await req.text();
  if (raw.length > 50_000) return NextResponse.json({ ok: false }, { status: 413 });
  const body = verifySig(raw, req.headers.get('x-nowpayments-sig'));
  if (!body) return NextResponse.json({ ok: false, error: 'Bad signature.' }, { status: 401 });
  const { status, ...rest } = await settleOrder(body);
  return NextResponse.json(rest, { status });
}
