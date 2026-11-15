import { NextResponse } from 'next/server';
import { getWallet } from '@/lib/server/wallet';
import { userId, unauthorized } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

// Per-user data: never cached by the network, the browser keeps its own stale-while-revalidate copy.
// The history is paged (?limit=&offset=&kind=): the screen shows a page at a time, 20 by default.
export async function GET(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const limit = Math.min(100, Math.max(1, Number(sp.get('limit')) || 20));
  const offset = Math.max(0, Number(sp.get('offset')) || 0);
  const k = sp.get('kind');
  const kind = k === 'payout' || k === 'withdrawal' || k === 'deposit' ? k : 'all';
  return NextResponse.json(await getWallet(id, undefined, { limit, offset, kind }), { headers: { 'Cache-Control': 'private, no-store' } });
}
