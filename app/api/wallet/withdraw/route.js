import { NextResponse } from 'next/server';
import { readJson } from '@/lib/server/body';
import { withdraw } from '@/lib/server/wallet';
import { userId, unauthorized, reserve, giveBack, clearFails } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  let body;
  try {
    body = await readJson(req);
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }
  // A code attempt is counted before it is checked; only a wrong code stays counted (same limit as sign-in).
  const codeKey = `w:${id}`;
  const withCode = !!body?.code;
  if (withCode && (await reserve(codeKey))) return NextResponse.json({ ok: false, error: 'Too many attempts. Try again in 15 minutes.' }, { status: 429, headers: { 'Cache-Control': 'no-store' } });
  const { status, ...rest } = await withdraw(body, { userId: id, key: req.headers.get('idempotency-key') || undefined });
  if (withCode) {
    if (rest.ok) await clearFails(codeKey);
    else if (!(rest.field === 'code' && !rest.need2fa)) await giveBack(codeKey);
  }
  return NextResponse.json(rest, { status, headers: { 'Cache-Control': 'no-store' } });
}
