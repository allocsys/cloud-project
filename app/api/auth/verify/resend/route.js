import { NextResponse } from 'next/server';
import { sendVerification, userId, unauthorized, clientIp, throttled, noteFail } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

// Links in emails use a fixed address, never the request's Host header. Set APP_URL once the app has its own domain.
const BASE_URL = (process.env.APP_URL || 'https://opus-cloud-mining-production.up.railway.app').replace(/\/+$/, '');

// Signed-in user asks for a fresh verification email (Settings).
export async function POST(req) {
  const id = await userId(req);
  if (!id || id === 'demo') return unauthorized();
  const key = `m:${clientIp(req)}`;
  if (await throttled(key)) {
    return NextResponse.json({ ok: false, error: 'Too many attempts. Try again in 15 minutes.' }, { status: 429, headers: NO_STORE });
  }
  await noteFail(key);
  const { status, ...rest } = await sendVerification(id, BASE_URL);
  return NextResponse.json(rest, { status, headers: NO_STORE });
}
