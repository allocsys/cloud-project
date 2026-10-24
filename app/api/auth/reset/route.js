import { NextResponse } from 'next/server';
import { requestReset, clientIp, reserve, giveBack } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

// Links in reset emails use a fixed address, never the request's Host header, so a forged header cannot point them elsewhere.
// Set APP_URL (for example https://opus.example.com) once the app has its own domain.
const BASE_URL = (process.env.APP_URL || 'https://opus-cloud-mining-production.up.railway.app').replace(/\/+$/, '');

export async function POST(req) {
  const key = `r:${clientIp(req)}`;
  // Counts every request from this address, counted first in one statement.
  if (await reserve(key)) {
    return NextResponse.json({ ok: false, error: 'Too many attempts. Try again in 15 minutes.' }, { status: 429, headers: NO_STORE });
  }
  let body;
  try {
    body = await req.json();
  } catch {
    await giveBack(key);
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400, headers: NO_STORE });
  }
  const { status, ...rest } = await requestReset(body, BASE_URL);
  return NextResponse.json(rest, { status, headers: NO_STORE });
}
