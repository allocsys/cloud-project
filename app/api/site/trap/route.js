import { NextResponse } from 'next/server';
import { readJson } from '@/lib/server/body';
import { fromSvc } from '@/lib/edge';
import { recordTrap } from '@/lib/server/trap';

// The web service tells the API that /password.txt was opened (app/(site)/password.txt/route.js). Only the web service may call it.
export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(req) {
  if (process.env.API_SVC_SECRET && !fromSvc(req.headers)) return NextResponse.json({ ok: false, error: 'Forbidden.' }, { status: 403, headers: NO_STORE });
  let body;
  try {
    body = await readJson(req);
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400, headers: NO_STORE });
  }
  await recordTrap('file', { ip: body?.ip, ua: body?.ua }).catch(() => {});
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
