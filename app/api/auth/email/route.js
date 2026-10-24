import { NextResponse } from 'next/server';
import { addEmailStart, addEmailConfirm, setSession, userId, unauthorized, reserve, giveBack, clearFails } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

// A Telegram account adds an email and password. { action: 'start', email, password } mails a 6-digit code,
// { action: 'confirm', code } saves the email on the account and signs this device in again (other devices are signed out).
// Every request counts toward the sign-in lockout, so codes and mails cannot be hammered. Counted first in one statement.
export async function POST(req) {
  const id = await userId(req);
  if (!id || id === 'demo') return unauthorized();
  const key = `e:${id}`;
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
  const action = String(body?.action ?? '');
  const run = action === 'start' ? addEmailStart(id, body) : action === 'confirm' ? addEmailConfirm(id, body) : null;
  if (!run) {
    await giveBack(key);
    return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400, headers: NO_STORE });
  }
  const { status, ...rest } = await run;
  if (!rest.ok) return NextResponse.json(rest, { status, headers: NO_STORE });
  if (action === 'confirm') {
    await clearFails(key);
    return await setSession(NextResponse.json({ ok: true }, { headers: NO_STORE }), id);
  }
  return NextResponse.json(rest, { headers: NO_STORE });
}
