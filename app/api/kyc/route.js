import { NextResponse } from 'next/server';
import { MAX_PHOTO } from '@/lib/kyc';
import { readCapped } from '@/lib/server/body';
import { getKyc, submitKyc } from '@/lib/server/kyc';
import { userId, unauthorized } from '@/lib/server/auth';
import { over } from '@/lib/rate-mem';
import { idemGet } from '@/lib/server/db';
import { guarded } from '@/lib/server/shed';

export const dynamic = 'force-dynamic';
export const GET = guarded(GET_);
export const POST = guarded(POST_);

const NO_STORE = { 'Cache-Control': 'no-store' };
const KYC_TRIES = 10; // uploads per account per 15 minutes

async function GET_(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  return NextResponse.json(await getKyc(id), { headers: NO_STORE });
}

const MAX_FORM = 2 * MAX_PHOTO + 1_000_000; // two photos and the text fields

async function POST_(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  // Refused before the photos are read when there is nothing left to submit, and a few tries per account every 15 minutes.
  if ((await getKyc(id)).status !== 'none') {
    // A retry of the call that did submit (same Idempotency-Key) still gets its first answer, as submitKyc gives it.
    const key = req.headers.get('idempotency-key');
    const prior = key ? await idemGet(`kyc:${id}:${key}`) : null;
    if (prior) {
      const { status, ...rest } = prior;
      return NextResponse.json(rest, { status, headers: NO_STORE });
    }
    return NextResponse.json({ ok: false, error: 'Verification was already submitted.' }, { status: 409, headers: NO_STORE });
  }
  if (over(`kyc:${id}`, KYC_TRIES, 15 * 60_000)) return NextResponse.json({ ok: false, error: 'Too many attempts. Try again in 15 minutes.' }, { status: 429, headers: { ...NO_STORE, 'Retry-After': '900' } });
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
