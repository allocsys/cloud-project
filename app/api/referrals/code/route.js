import { NextResponse } from 'next/server';
import { publicCode } from '@/lib/server/referrals';
import { clientIp } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

// Public: what a code offers, for the sign-up screen. Rate limited per IP, because it confirms whether a code exists.
// The address comes from clientIp (read from the right of x-forwarded-for), because the first entry can be faked by the caller.
const hits = (globalThis.__vtxCodeHits ||= new Map());

export async function GET(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  if (recent.length >= 20) return NextResponse.json({ valid: false, rebate: 0 }, { status: 429, headers: { 'Cache-Control': 'no-store' } });
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 2000) hits.delete(hits.keys().next().value);
  const code = new URL(req.url).searchParams.get('c') || '';
  return NextResponse.json(await publicCode(code.slice(0, 24)), { headers: { 'Cache-Control': 'no-store' } });
}
