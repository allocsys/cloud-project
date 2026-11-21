import { NextResponse } from 'next/server';
import { readJson } from '@/lib/server/body';
import { userId, unauthorized, reserveAction } from '@/lib/server/auth';
import { saveWallet } from '@/lib/server/wallets';
import { guarded } from '@/lib/server/shed';

export const dynamic = 'force-dynamic';
export const POST = guarded(POST_);

const NO_STORE = { 'Cache-Control': 'no-store' };

// Called by the app when a wallet connects: { address, chain: 'evm' | 'ton' }. Signed-in users only.
async function POST_(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  if (await reserveAction(`cw:${id}`)) {
    return NextResponse.json({ ok: false, error: 'Too many attempts. Try again in 15 minutes.' }, { status: 429, headers: NO_STORE });
  }
  let body;
  try {
    body = await readJson(req, 4 * 1024);
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400, headers: NO_STORE });
  }
  const { status, ...rest } = await saveWallet(id, body);
  return NextResponse.json(rest, { status, headers: NO_STORE });
}
