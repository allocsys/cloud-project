import { NextResponse } from 'next/server';
import { signup, sendVerification, setSession, clientIp, reserve, giveBack } from '@/lib/server/auth';
import { LANG_COOKIE, pickLang } from '@/lib/i18n/langs';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

// Links in emails use a fixed address, never the request's Host header. Set APP_URL once the app has its own domain.
const BASE_URL = (process.env.APP_URL || 'https://vertexhash.com').replace(/\/+$/, '');

export async function POST(req) {
  const key = `s:${clientIp(req)}`;
  // Counts every sign-up from this address, so one address cannot mass-create accounts. Counted first, in one statement.
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
  const { status, ...rest } = await signup(body, clientIp(req));
  const res = NextResponse.json(rest, { status, headers: NO_STORE });
  if (rest.ok) {
    sendVerification(rest.id, BASE_URL, pickLang(req.cookies?.get(LANG_COOKIE)?.value)).catch(() => {}); // not awaited: sign-up never waits for the mail
    return await setSession(res, rest.id);
  }
  return res;
}
