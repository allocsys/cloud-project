import { NextResponse } from 'next/server';
import { getLive } from '@/lib/server/market';
import { minersRunning, payoutProof } from '@/lib/server/network-stats';
import { guarded } from '@/lib/server/shed';

export const dynamic = 'force-dynamic';
export const GET = guarded(GET_);

// The real figures on the public /status page: Bitcoin difficulty (null with no trustworthy reading), the miners running, and the
// proof that withdrawals are paid (null when the database cannot answer). Nothing here names a user, an address or a transaction.
async function GET_() {
  let difficulty = null;
  try {
    difficulty = (await getLive())?.difficulty ?? null;
  } catch {}
  const [miners, proof] = await Promise.all([minersRunning(), payoutProof()]);
  return NextResponse.json({ difficulty, miners, proof }, { headers: { 'Cache-Control': 'no-store' } });
}
