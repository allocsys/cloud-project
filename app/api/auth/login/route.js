import { NextResponse } from 'next/server';
import { login, setSession, clientIp, throttled, noteFail, clearFails } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400, headers: NO_STORE });
  }
  const key = `l:${clientIp(req)}:${String(body?.email ?? '').trim().toLowerCase().slice(0, 120)}`;
  if (await throttled(key)) {
    return NextResponse.json({ ok: false, error: 'Too many attempts. Try again in 15 minutes.' }, { status: 429, headers: NO_STORE });
  }
  const { status, ...rest } = await login(body);
  if (!rest.ok) {
    await noteFail(key);
    return NextResponse.json(rest, { status, headers: NO_STORE });
  }
  await clearFails(key);
  return await setSession(NextResponse.json(rest, { headers: NO_STORE }), rest.id);
}
