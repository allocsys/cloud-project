import { NextResponse } from 'next/server';
import { getWalletBundle } from '@/lib/server/bundle';
import { userId, unauthorized } from '@/lib/server/auth';
import { guarded } from '@/lib/server/shed';

export const dynamic = 'force-dynamic';
export const GET = guarded(GET_);

// The wallet page's per-user data in one call (see lib/server/bundle.js). Never cached by the network.
async function GET_(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  return NextResponse.json(await getWalletBundle(id), { headers: { 'Cache-Control': 'private, no-store' } });
}
