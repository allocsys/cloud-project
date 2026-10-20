import { NextResponse } from 'next/server';
import { confirmReset, setSession, clientIp, throttled, noteFail } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

// Choose a new password with the emailed token (and a two-factor code when the account has one). Success signs the person in.
export async function POST(req) {
  const key = `c:${clientIp(req)}`;
  if (await throttled(key)) {
    return NextResponse.json({ ok: false, error: 'Too many attempts. Try again in 15 minutes.' }, { status: 429, headers: NO_STORE });
  }
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400, headers: NO_STORE });
  }
  const { status, ...rest } = await confirmReset(body);
  if (!rest.ok) {
    if (!rest.need2fa) await noteFail(key); // asking for the two-factor code is not a failed attempt
    return NextResponse.json(rest, { status, headers: NO_STORE });
  }
  return await setSession(NextResponse.json({ ok: true }, { headers: NO_STORE }), rest.id);
}
