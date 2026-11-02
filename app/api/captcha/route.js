import { NextResponse } from 'next/server';
import { captchaKey } from '@/lib/server/captcha';

export const dynamic = 'force-dynamic';

// The public site key of the bot check, or null when it is off. The forms read it at run time, so no rebuild is needed to switch it on.
export async function GET() {
  return NextResponse.json({ key: captchaKey() }, { headers: { 'Cache-Control': 'public, max-age=300' } });
}
