import { NextResponse } from 'next/server';
import { publicCode } from '@/lib/server/referrals';

export const dynamic = 'force-dynamic';

// Public: what a code offers, for the sign-up screen. Rate limited per IP, because it confirms whether a code exists.
const hits = (globalThis.__vtxCodeHits ||= new Map());

export async function GET(req) {
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  if (recent.length >= 20) return NextResponse.json({ valid: false, rebate: 0 }, { status: 429, headers: { 'Cache-Control': 'no-store' } });
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 2000) hits.delete(hits.keys().next().value);
  const code = new URL(req.url).searchParams.get('c') || '';
  return NextResponse.json(await publicCode(code.slice(0, 24)), { headers: { 'Cache-Control': 'no-store' } });
}
