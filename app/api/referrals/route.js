import { NextResponse } from 'next/server';
import { getReferral, inviteGate } from '@/lib/server/account';
import { createCode, raiseCode, deleteCode } from '@/lib/server/referrals';
import { userId, unauthorized } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'private, no-store' };

export async function GET(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  return NextResponse.json(await getReferral(id), { headers: NO_STORE });
}

// Manage the user's own invite codes: { action: 'create', name, rebate } | { action: 'raise', code, rebate } | { action: 'delete', code }.
export async function POST(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  let body = null;
  try {
    body = await req.json();
  } catch {}
  if (!(await inviteGate(id)).unlocked) return NextResponse.json({ ok: false, error: 'Buy a plan to unlock invites.' }, { status: 403, headers: NO_STORE });
  const a = body?.action;
  const r =
    a === 'create' ? await createCode(id, body)
    : a === 'raise' ? await raiseCode(id, body.code, body.rebate)
    : a === 'delete' ? await deleteCode(id, body.code)
    : { ok: false, status: 400, error: 'Unknown action.' };
  return NextResponse.json(r.ok ? { ok: true, ...getReferral(id) } : { ok: false, error: r.error }, { status: r.status, headers: NO_STORE });
}
