import { NextResponse } from 'next/server';
import { changePassword, setSession, userId, unauthorized, reserve, giveBack, clearFails } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

// Change the password of the signed-in account. A wrong current password counts toward the same lockout as sign-in.
// Counted first in one statement.
export async function POST(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  const key = `p:${id}`;
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
  const { status, ...rest } = await changePassword(id, body);
  if (!rest.ok) {
    if (rest.field !== 'current') await giveBack(key);
    return NextResponse.json(rest, { status, headers: NO_STORE });
  }
  await clearFails(key);
  // Every older session just stopped working, so this device gets a fresh cookie.
  return await setSession(NextResponse.json({ ok: true }, { headers: NO_STORE }), id);
}
