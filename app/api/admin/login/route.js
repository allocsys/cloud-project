import { NextResponse } from 'next/server';
import { COOKIE, MAX_AGE, adminEnabled, needsSetup, setupAdmin, checkLogin, newSession, clientIp, reserve, giveBack, clearFails } from '@/lib/server/admin';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(req) {
  if (!adminEnabled()) {
    return NextResponse.json({ ok: false, off: true, error: 'Admin is off. Set ADMIN_TOKEN (12 or more characters) and redeploy.' }, { status: 503, headers: NO_STORE });
  }
  const ip = clientIp(req);
  // Counted first in one statement, so a burst of parallel guesses cannot all pass the limit.
  if (await reserve(ip)) {
    return NextResponse.json({ ok: false, error: 'Too many attempts. Try again in 15 minutes.' }, { status: 429, headers: NO_STORE });
  }
  let body;
  try {
    body = await req.json();
  } catch {
    await giveBack(ip);
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400, headers: NO_STORE });
  }
  if (await needsSetup()) {
    const r = await setupAdmin(body?.token, body?.user, body?.pass);
    if (!r.ok) {
      if (!r.bad) await giveBack(ip);
      return NextResponse.json({ ok: false, error: r.error }, { status: r.status, headers: NO_STORE });
    }
  } else if (!(await checkLogin(body?.user, body?.pass))) {
    return NextResponse.json({ ok: false, error: 'Wrong username or password.' }, { status: 401, headers: NO_STORE });
  }
  await clearFails(ip);
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
