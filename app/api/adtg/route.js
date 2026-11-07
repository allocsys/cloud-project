import { NextResponse } from 'next/server';
import { overview } from '@/lib/server/admin';
import { reviewEnabled, reviewerOf, reviewView } from '@/lib/server/reviewers';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (body, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

// Read only: there is no POST, PUT or DELETE here, so a reviewer cannot change anything.
export async function GET(req) {
  if (!reviewEnabled()) return json({ ok: false, off: true, error: 'Review access is off.' }, 503);
  const who = await reviewerOf(req);
  if (!who) return json({ ok: false, error: 'Sign in required.' }, 401);
  return json({ ok: true, who, ...reviewView(await overview()) });
}
