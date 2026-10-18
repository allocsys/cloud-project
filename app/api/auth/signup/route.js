import { NextResponse } from 'next/server';
import { signup, setSession, clientIp, throttled, noteFail } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(req) {
  const ip = clientIp(req);
  if (throttled(`s:${ip}`)) {
    return NextResponse.json({ ok: false, error: 'Too many attempts. Try again in 15 minutes.' }, { status: 429, headers: NO_STORE });
  }
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400, headers: NO_STORE });
  }
  noteFail(`s:${ip}`); // counts every sign-up from this address, so one address cannot mass-create accounts
  const { status, ...rest } = signup(body);
  const res = NextResponse.json(rest, { status, headers: NO_STORE });
  return rest.ok ? setSession(res, rest.id) : res;
}
