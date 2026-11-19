import { NextResponse } from 'next/server';
import { captchaKey } from '@/lib/server/captcha';
import { guarded } from '@/lib/server/shed';

export const dynamic = 'force-dynamic';
export const GET = guarded(GET_);

// The public site key of the bot check, or null when it is off. The forms read it at run time, so no rebuild is needed to switch it on.
async function GET_() {
  return NextResponse.json({ key: captchaKey() }, { headers: { 'Cache-Control': 'public, max-age=300' } });
}
