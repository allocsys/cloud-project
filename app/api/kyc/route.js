import { NextResponse } from 'next/server';
import { getKyc, submitKyc } from '@/lib/server/kyc';
import { userId, unauthorized } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(req) {
  const id = userId(req);
  if (!id) return unauthorized();
  return NextResponse.json(getKyc(id), { headers: NO_STORE });
}

export async function POST(req) {
  const id = userId(req);
  if (!id) return unauthorized();
  let form;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400, headers: NO_STORE });
  }
  const { status, ...rest } = submitKyc(form, { userId: id, key: req.headers.get('idempotency-key') || undefined });
  return NextResponse.json(rest, { status, headers: NO_STORE });
}
