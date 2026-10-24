import { NextResponse } from 'next/server';
import { twofaStart, twofaEnable, twofaDisable, userId, unauthorized, reserve, giveBack, clearFails } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

// Two-factor for the signed-in account. { action: 'start' } returns a new key to add to an authenticator app,
// { action: 'enable', code } turns it on and returns the recovery codes, { action: 'disable', password, code } turns it off.
// Wrong codes and passwords count toward the same lockout as sign-in. Counted first in one statement.
export async function POST(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  const key = `f:${id}`;
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
  const run = action === 'start' ? twofaStart(id) : action === 'enable' ? twofaEnable(id, body) : action === 'disable' ? twofaDisable(id, body) : null;
  if (!run) {
    await giveBack(key);
    return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400, headers: NO_STORE });
  }
  const { status, ...rest } = await run;
  if (!rest.ok) {
    if (!rest.field) await giveBack(key);
    return NextResponse.json(rest, { status, headers: NO_STORE });
  }
  if (action !== 'start') await clearFails(key);
  else await giveBack(key);
  return NextResponse.json(rest, { headers: NO_STORE });
}
