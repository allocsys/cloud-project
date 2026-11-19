import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Debug only: the wallet button sends its connect error here so it shows in the Railway logs.
// It logs the message (cut to 300 characters) and the browser type. No addresses, no account data. Remove with the debug change.
export async function POST(req) {
  let body = null;
  try {
    body = await req.json();
  } catch {}
  const msg = String(body?.message || 'unknown error')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 300);
  const ua = (req.headers.get('user-agent') || '').slice(0, 120);
  console.error(`[wallet-connect] ${msg} | ${ua}`);
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
