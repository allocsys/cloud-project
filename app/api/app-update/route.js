import { NextResponse } from 'next/server';
import { guarded } from '@/lib/server/shed';
import { latestApp } from '@/lib/server/app-update';
import { answerFor } from '@/lib/app-update';

export const dynamic = 'force-dynamic';
export const GET = guarded(GET_);

// The Android app asks here (?code=<installed version code>) whether a newer version exists and where to get it.
// Same answer for everyone with the same version, no sign-in needed.
async function GET_(req) {
  const have = Number(new URL(req.url).searchParams.get('code'));
  const v = Number.isInteger(have) && have >= 0 ? await latestApp() : null;
  return NextResponse.json(answerFor(v, have), { headers: { 'Cache-Control': 'no-store' } });
}
