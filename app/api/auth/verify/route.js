import { NextResponse } from 'next/server';
import { confirmVerify, clientIp, throttled, noteFail } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

// Confirms an email address from the link in the verification email.
export async function POST(req) {
  const key = `v:${clientIp(req)}`;
  if (await throttled(key)) {
    return NextResponse.json({ ok: false, error: 'Too many attempts. Try again in 15 minutes.' }, { status: 429, headers: NO_STORE });
  }
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400, headers: NO_STORE });
  }
  await noteFail(key);
  const { status, ...rest } = await confirmVerify(body);
  return NextResponse.json({ ok: rest.ok, error: rest.error }, { status, headers: NO_STORE });
}
