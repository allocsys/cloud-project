import { NextResponse } from 'next/server';
import { closePreview, closeAccount, clearSession, userId, unauthorized, throttled, noteFail, clearFails } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

// GET: what closing the account would do (running miners, anything that blocks it, whether a password or code is needed).
export async function GET(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  const { status, ...rest } = await closePreview(id);
  return NextResponse.json(rest, { status: rest.ok ? 200 : status, headers: NO_STORE });
}

// POST { password, code, confirm: 'DELETE', forfeit }: closes the signed-in account and signs it out.
// Wrong passwords and codes count toward the same lockout as sign-in.
export async function POST(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  const key = `c:${id}`;
  if (await throttled(key)) {
    return NextResponse.json({ ok: false, error: 'Too many attempts. Try again in 15 minutes.' }, { status: 429, headers: NO_STORE });
  }
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400, headers: NO_STORE });
  }
  const { status, ...rest } = await closeAccount(id, body);
  if (!rest.ok) {
    if (rest.field) await noteFail(key);
    return NextResponse.json(rest, { status, headers: NO_STORE });
  }
  await clearFails(key);
  return clearSession(NextResponse.json({ ok: true }, { headers: NO_STORE }));
}
