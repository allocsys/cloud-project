import { NextResponse } from 'next/server';
import { readJson } from '@/lib/server/body';
import { addPhone, dropPhone } from '@/lib/server/account';
import { userId, unauthorized } from '@/lib/server/auth';
import { guarded } from '@/lib/server/shed';

export const dynamic = 'force-dynamic';
export const POST = guarded(POST_);
export const DELETE = guarded(DELETE_);

const NO_STORE = { 'Cache-Control': 'no-store' };

async function body(req) {
  try {
    return await readJson(req, 8 * 1024);
  } catch {
    return null;
  }
}

// POST { token, lang }: this phone gets the account's notices (Android app, components/PushSetup.js). Same token again = no change.
async function POST_(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  const b = await body(req);
  const r = await addPhone(id, b?.token, b?.lang);
  return NextResponse.json(r, { status: r.ok ? 200 : 400, headers: NO_STORE });
}

// DELETE { token }: this phone stops getting them (signed out).
async function DELETE_(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  const b = await body(req);
  const r = await dropPhone(id, b?.token);
  return NextResponse.json(r, { status: r.ok ? 200 : 400, headers: NO_STORE });
}
