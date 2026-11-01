import { NextResponse } from 'next/server';
import { MAX_PHOTO } from '@/lib/kyc';
import { readCapped } from '@/lib/server/body';
import { getKyc, submitKyc } from '@/lib/server/kyc';
import { userId, unauthorized } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  return NextResponse.json(await getKyc(id), { headers: NO_STORE });
}

const MAX_FORM = 2 * MAX_PHOTO + 1_000_000; // two photos and the text fields

export async function POST(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  let form;
  try {
    const buf = await readCapped(req, MAX_FORM);
    if (buf === null) return NextResponse.json({ ok: false, error: 'Photos are too large (max 12 MB each).' }, { status: 413, headers: NO_STORE });
    form = await new Response(buf, { headers: { 'content-type': req.headers.get('content-type') || '' } }).formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400, headers: NO_STORE });
  }
  const { status, ...rest } = await submitKyc(form, { userId: id, key: req.headers.get('idempotency-key') || undefined });
  return NextResponse.json(rest, { status, headers: NO_STORE });
}
