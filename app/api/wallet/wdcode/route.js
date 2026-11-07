import { NextResponse } from 'next/server';
import { tgCodeState } from '@/lib/server/wallet';
import { userId, unauthorized } from '@/lib/server/auth';
import { BOT_NAME } from '@/lib/server/botname';

export const dynamic = 'force-dynamic';

// The withdraw screen asks this every few seconds while it waits for the Accept tap in Telegram: { state: 'wait' | 'approved' | 'none' }.
export async function GET(req) {
  const id = await userId(req);
  if (!id) return unauthorized();
  const { status, ...rest } = await tgCodeState(id);
  return NextResponse.json({ ...rest, bot: BOT_NAME }, { status, headers: { 'Cache-Control': 'no-store' } });
}
