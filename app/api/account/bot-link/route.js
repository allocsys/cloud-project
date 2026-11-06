import { NextResponse } from 'next/server';
import { botLinkStart } from '@/lib/server/botlink';
import { userId, unauthorized, reserveAction } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

// A link code for the Telegram bot (email accounts). The code is shown once; only its hash is kept.
export async function POST(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  if (await reserveAction(`k:${id}`)) {
    return NextResponse.json({ ok: false, error: 'Too many attempts. Try again in 15 minutes.' }, { status: 429, headers: NO_STORE });
  }
  const { status, ...rest } = await botLinkStart(id);
  return NextResponse.json(rest, { status, headers: NO_STORE });
}
