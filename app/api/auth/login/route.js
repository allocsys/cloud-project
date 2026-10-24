import { NextResponse } from 'next/server';
import { login, setSession, clientIp, reserve, giveBack, clearFails } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const tooMany = () => NextResponse.json({ ok: false, error: 'Too many attempts. Try again in 15 minutes.' }, { status: 429, headers: NO_STORE });

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400, headers: NO_STORE });
  }
  const email = String(body?.email ?? '').trim().toLowerCase().slice(0, 120);
  const key = `l:${clientIp(req)}:${email}`;
  // Wrong two-factor codes are also counted per account, from any address, so many addresses cannot share the guessing.
  const codeKey = `t:${email}`;
  // Each attempt is counted before it is checked (one statement), so a burst of parallel requests cannot all pass the limit.
  if (await reserve(key)) return tooMany();
  const withCode = !!body?.code;
  if (withCode && (await reserve(codeKey))) return tooMany();
  const { status, ...rest } = await login(body);
  if (!rest.ok) {
    // Asking for the code (need2fa) means the password was right: it is not a failed attempt.
    if (rest.need2fa) await giveBack(key);
    // The per-account code count is only for wrong codes.
    if (withCode && !(rest.field === 'code' && !rest.need2fa)) await giveBack(codeKey);
    return NextResponse.json(rest, { status, headers: NO_STORE });
  }
  await clearFails(key);
  await clearFails(codeKey);
  return await setSession(NextResponse.json(rest, { headers: NO_STORE }), rest.id);
}
