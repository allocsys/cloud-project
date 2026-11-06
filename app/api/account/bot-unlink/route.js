import { NextResponse } from 'next/server';
import { botDisconnect } from '@/lib/server/botlink';
import { userId, unauthorized, reserveAction } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

// Settings > Disconnect: removes the Telegram bot link from the signed-in email account.
export async function POST(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  if (await reserveAction(`k:${id}`)) {
    return NextResponse.json({ ok: false, error: 'Too many attempts. Try again in 15 minutes.' }, { status: 429, headers: NO_STORE });
  }
  const { status, ...rest } = await botDisconnect(id);
  return NextResponse.json(rest, { status, headers: NO_STORE });
}
