import { NextResponse } from 'next/server';
import { getPlansBundle, getSettingsBundle, getMinerBundle } from '@/lib/server/bundle';
import { userId, unauthorized } from '@/lib/server/auth';
import { guarded } from '@/lib/server/shed';

export const dynamic = 'force-dynamic';
export const GET = guarded(GET_);

const HEAD = { 'Cache-Control': 'private, no-store' };

// A page's per-user data in one call (lib/server/bundle.js): /api/bundle/plans, /api/bundle/settings, /api/bundle/miner?serial=.
// Never cached by the network.
async function GET_(req, { params }) {
  const id = await userId(req);
  if (!id) return unauthorized();
  const { name } = await params;
  if (name === 'plans') return NextResponse.json(await getPlansBundle(id), { headers: HEAD });
  if (name === 'settings') return NextResponse.json(await getSettingsBundle(id), { headers: HEAD });
  if (name === 'miner') {
    const serial = String(req.nextUrl.searchParams.get('serial') || '').slice(0, 40);
    return NextResponse.json(await getMinerBundle(id, serial), { headers: HEAD });
  }
  return NextResponse.json({ error: 'Not found.' }, { status: 404, headers: HEAD });
}
