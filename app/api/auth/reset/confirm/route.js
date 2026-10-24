import { NextResponse } from 'next/server';
import { confirmReset, setSession, clientIp, reserve, giveBack } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

// Choose a new password with the emailed token (and a two-factor code when the account has one). Success signs the person in.
export async function POST(req) {
  const key = `c:${clientIp(req)}`;
  // Counted first in one statement; only a failed attempt keeps its count.
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
  const { status, ...rest } = await confirmReset(body);
  if (!rest.ok) {
    if (rest.need2fa) await giveBack(key); // asking for the two-factor code is not a failed attempt
    return NextResponse.json(rest, { status, headers: NO_STORE });
  }
  await giveBack(key);
  return await setSession(NextResponse.json({ ok: true }, { headers: NO_STORE }), rest.id);
}
