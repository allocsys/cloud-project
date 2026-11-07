import { NextResponse } from 'next/server';
import { readJson } from '@/lib/server/body';
import { clientIp, reserve, giveBack, clearFails } from '@/lib/server/admin';
import { REVIEW_COOKIE, REVIEW_MAX_AGE, reviewEnabled, reviewerLogin, reviewSession } from '@/lib/server/reviewers';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(req) {
  if (!reviewEnabled()) return NextResponse.json({ ok: false, off: true, error: 'Review access is off.' }, { status: 503, headers: NO_STORE });
  const ip = clientIp(req);
  // Same limit as the admin sign-in: five wrong tries lock an address for 15 minutes. Counted first, so parallel guesses cannot all pass.
  if (await reserve(ip)) {
    return NextResponse.json({ ok: false, error: 'Too many attempts. Try again in 15 minutes.' }, { status: 429, headers: NO_STORE });
  }
  let body;
  try {
    body = await readJson(req);
  } catch {
    await giveBack(ip);
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400, headers: NO_STORE });
  }
  const r = await reviewerLogin(body?.user, body?.pass);
  if (!r) return NextResponse.json({ ok: false, error: 'Wrong username or password.' }, { status: 401, headers: NO_STORE });
  await clearFails(ip);
  const res = NextResponse.json({ ok: true }, { headers: NO_STORE });
  res.cookies.set(REVIEW_COOKIE, reviewSession(r), {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: REVIEW_MAX_AGE,
  });
  return res;
}

// Sign out: clear the cookie.
export async function DELETE() {
  const res = NextResponse.json({ ok: true }, { headers: NO_STORE });
  res.cookies.set(REVIEW_COOKIE, '', { httpOnly: true, sameSite: 'strict', path: '/', maxAge: 0 });
  return res;
}
