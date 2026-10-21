import { NextResponse } from 'next/server';
import { settleOrder } from '@/lib/server/miners';
import { cryptoEnabled, verifyCallback } from '@/lib/server/pay-provider';
import { checkRateLimit, incrementRateLimit, webhookRateLimit } from '@/lib/server/rate-limit';

export const dynamic = 'force-dynamic';

// Payment callback from the active provider. Only a body with a valid signature is acted on (x-gateway-sig or x-nowpayments-sig).
// Duplicate deliveries are harmless: settleOrder activates an order once.
// Rate limited to prevent abuse.
export async function POST(req) {
  if (!cryptoEnabled()) return NextResponse.json({ ok: false }, { status: 503 });
  
  // Rate limiting for webhook
  const ip = (req.headers.get('x-forwarded-for') || req.ip || 'unknown').split(',')[0].trim();
  const webhookKey = `webhook:${ip}:payments`;
  const rateLimitConfig = webhookRateLimit('paymentsWebhook');
  
  const rateResult = await checkRateLimit(webhookKey, rateLimitConfig);
  if (rateResult.limited) {
    return NextResponse.json({
      ok: false, 
      error: 'Too many requests. Please try again later.',
      retryAfter: Math.ceil((rateResult.resetAt - Date.now()) / 1000)
    }, {
      status: 429,
      headers: {
        'Retry-After': String(Math.ceil((rateResult.resetAt - Date.now()) / 1000))
      }
    });
  }
  
  const raw = await req.text();
  if (raw.length > 50_000) return NextResponse.json({ ok: false }, { status: 413 });
  
  const body = verifyCallback(raw, req.headers);
  if (!body) {
    // Still increment on failed verification to prevent brute force
    await incrementRateLimit(webhookKey, rateLimitConfig);
    return NextResponse.json({ ok: false, error: 'Bad signature.' }, { status: 401 });
  }
  
  await incrementRateLimit(webhookKey, rateLimitConfig);
  const { status, ...rest } = await settleOrder(body);
  return NextResponse.json(rest, { status });
}
