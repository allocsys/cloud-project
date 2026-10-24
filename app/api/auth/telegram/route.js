import { NextResponse } from 'next/server';
import { telegramLogin, setSession, clientIp, reserve, giveBack } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(req) {
  const key = `t:${clientIp(req)}`;
  // Counted first, in one statement; only a failed verification (401) keeps its count.
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
  const { status, ...rest } = await telegramLogin(body?.initData, body?.ref);
  if (!rest.ok) {
    if (status !== 401) await giveBack(key);
    return NextResponse.json(rest, { status, headers: NO_STORE });
  }
  await giveBack(key);
  return await setSession(NextResponse.json(rest, { headers: NO_STORE }), rest.id);
}
