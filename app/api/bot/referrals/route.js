import { NextResponse } from 'next/server';
import { readCapped } from '@/lib/server/body';
import { serve, referralsFor, MAX_BODY } from '@/lib/server/botapi';

export const dynamic = 'force-dynamic';

// Called only by the Telegram bot service (signed with APP_BOT_SECRET). Read-only.
export async function POST(req) {
  const buf = await readCapped(req, MAX_BODY);
  if (buf === null) return NextResponse.json({ ok: false }, { status: 413 });
  const { status, json } = await serve(buf.toString('utf8'), req.headers.get('x-app-sig'), referralsFor);
  return NextResponse.json(json, { status, headers: { 'Cache-Control': 'no-store' } });
}
