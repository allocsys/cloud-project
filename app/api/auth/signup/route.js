import { NextResponse } from 'next/server';
import { signup, sendVerification, setSession, clientIp, throttled, noteFail } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

// Links in emails use a fixed address, never the request's Host header. Set APP_URL once the app has its own domain.
const BASE_URL = (process.env.APP_URL || 'https://opus-cloud-mining-production.up.railway.app').replace(/\/+$/, '');

export async function POST(req) {
  const ip = clientIp(req);
  if (await throttled(`s:${ip}`)) {
    return NextResponse.json({ ok: false, error: 'Too many attempts. Try again in 15 minutes.' }, { status: 429, headers: NO_STORE });
  }
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400, headers: NO_STORE });
  }
  await noteFail(`s:${ip}`); // counts every sign-up from this address, so one address cannot mass-create accounts
  const { status, ...rest } = await signup(body);
  const res = NextResponse.json(rest, { status, headers: NO_STORE });
  if (rest.ok) {
    sendVerification(rest.id, BASE_URL).catch(() => {}); // not awaited: sign-up never waits for the mail
    return await setSession(res, rest.id);
  }
  return res;
}
