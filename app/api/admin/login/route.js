import { NextResponse } from 'next/server';
import { COOKIE, MAX_AGE, adminEnabled, checkToken, newSession, clientIp, throttled, noteFail, clearFails } from '@/lib/server/admin';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(req) {
  if (!adminEnabled()) {
    return NextResponse.json({ ok: false, off: true, error: 'Admin is off. Set ADMIN_TOKEN (12 or more characters) and redeploy.' }, { status: 503, headers: NO_STORE });
  }
  const ip = clientIp(req);
  if (throttled(ip)) {
    return NextResponse.json({ ok: false, error: 'Too many attempts. Try again in 15 minutes.' }, { status: 429, headers: NO_STORE });
  }
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400, headers: NO_STORE });
  }
  if (!checkToken(body?.token)) {
    noteFail(ip);
    return NextResponse.json({ ok: false, error: 'Wrong token.' }, { status: 401, headers: NO_STORE });
  }
  clearFails(ip);
  const res = NextResponse.json({ ok: true }, { headers: NO_STORE });
  res.cookies.set(COOKIE, newSession(), {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE,
  });
  return res;
}

// Sign out: clear the cookie.
export async function DELETE() {
  const res = NextResponse.json({ ok: true }, { headers: NO_STORE });
  res.cookies.set(COOKIE, '', { httpOnly: true, sameSite: 'strict', path: '/', maxAge: 0 });
  return res;
}
