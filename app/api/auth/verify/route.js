import { NextResponse } from 'next/server';
import { readJson } from '@/lib/server/body';
import { confirmVerify, clientIp, reserve, giveBack } from '@/lib/server/auth';
import { guarded } from '@/lib/server/shed';

export const dynamic = 'force-dynamic';
export const POST = guarded(POST_);

const NO_STORE = { 'Cache-Control': 'no-store' };

// Confirms an email address from the link in the verification email. Every request counts, counted first in one statement.
async function POST_(req) {
  const key = `v:${clientIp(req)}`;
  if (await reserve(key)) {
    return NextResponse.json({ ok: false, error: 'Too many attempts. Try again in 15 minutes.' }, { status: 429, headers: NO_STORE });
  }
  let body;
  try {
    body = await readJson(req);
  } catch {
    await giveBack(key);
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400, headers: NO_STORE });
  }
  const { status, ...rest } = await confirmVerify(body);
  return NextResponse.json({ ok: rest.ok, error: rest.error }, { status, headers: NO_STORE });
}
