import { NextResponse } from 'next/server';
import { telegramLogin, setSession, clientIp, throttled, noteFail } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(req) {
  const key = `t:${clientIp(req)}`;
  if (await throttled(key)) {
    return NextResponse.json({ ok: false, error: 'Too many attempts. Try again in 15 minutes.' }, { status: 429, headers: NO_STORE });
  }
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400, headers: NO_STORE });
  }
  const { status, ...rest } = await telegramLogin(body?.initData, body?.ref);
  if (!rest.ok) {
    if (status === 401) await noteFail(key);
    return NextResponse.json(rest, { status, headers: NO_STORE });
  }
  return await setSession(NextResponse.json(rest, { headers: NO_STORE }), rest.id);
}
