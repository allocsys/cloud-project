import { NextResponse } from 'next/server';
import { readJson } from '@/lib/server/body';
import { confirmReset, setSession, clientIp, reserve, giveBack, clearFails } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const tooMany = () => NextResponse.json({ ok: false, error: 'Too many attempts. Try again in 15 minutes.' }, { status: 429, headers: NO_STORE });

// Choose a new password with the emailed token (and a two-factor code when the account has one). Success signs the person in.
export async function POST(req) {
  const key = `c:${clientIp(req)}`;
  // Counted first in one statement; only a failed attempt keeps its count.
  if (await reserve(key)) return tooMany();
  let body;
  try {
    body = await readJson(req);
  } catch {
    await giveBack(key);
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400, headers: NO_STORE });
  }
  // Wrong two-factor codes are also counted per account, from any address (the same counter as sign-in), so many addresses cannot share
  // the guessing. A code is only tried against a valid link, so a wrong link never counts against the account.
  const codeKey = `t:${String(body?.email ?? '').trim().toLowerCase().slice(0, 120)}`;
  const withCode = !!body?.code;
  if (withCode && (await reserve(codeKey))) return tooMany();
  const { status, ...rest } = await confirmReset(body);
  if (withCode) {
    if (rest.ok) await clearFails(codeKey);
    else if (!(rest.field === 'code' && !rest.need2fa)) await giveBack(codeKey);
  }
  if (!rest.ok) {
    if (rest.need2fa) await giveBack(key); // asking for the two-factor code is not a failed attempt
    return NextResponse.json(rest, { status, headers: NO_STORE });
  }
  await giveBack(key);
  return await setSession(NextResponse.json({ ok: true }, { headers: NO_STORE }), rest.id);
}
