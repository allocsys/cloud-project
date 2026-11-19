import { NextResponse } from 'next/server';
import { tgCodeState } from '@/lib/server/wallet';
import { userId, unauthorized } from '@/lib/server/auth';
import { BOT_NAME } from '@/lib/server/botname';
import { guarded } from '@/lib/server/shed';

export const dynamic = 'force-dynamic';
export const GET = guarded(GET_);

// The withdraw screen asks this every few seconds while it waits for the Accept tap in Telegram: { state: 'wait' | 'approved' | 'none' }.
async function GET_(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  const { status, ...rest } = await tgCodeState(id);
  return NextResponse.json({ ...rest, bot: BOT_NAME }, { status, headers: { 'Cache-Control': 'no-store' } });
}
