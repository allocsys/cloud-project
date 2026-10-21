import { NextResponse } from 'next/server';
import { feedEnabled, checkKey, ingest } from '@/lib/server/telemetry';

export const dynamic = 'force-dynamic';

const json = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

// A hall's monitoring posts what its miners hashed:
//   POST /api/telemetry   Authorization: Bearer <TELEMETRY_KEY>
//   { "samples": [{ "serial": "OP-0004389", "th": 112.4, "at": 1761000000000 }] }   (at is optional, default now)
// Up to 1000 samples per request. Rows that do not pass are skipped and counted in "rejected".
export async function POST(req) {
  if (!feedEnabled()) return json({ ok: false, error: 'The hashrate feed is off. Set TELEMETRY_KEY (16 or more characters) and redeploy.' }, 503);
  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ') || !checkKey(auth.slice(7).trim())) return json({ ok: false, error: 'Wrong key.' }, 401);
  if (Number(req.headers.get('content-length') || 0) > 300_000) return json({ ok: false, error: 'Too large.' }, 413);
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'Invalid request.' }, 400);
  }
  if (!Array.isArray(body?.samples)) return json({ ok: false, error: 'Send { "samples": [...] }.' }, 400);
  try {
    return json({ ok: true, ...(await ingest(body.samples)) });
  } catch (e) {
    console.error('[telemetry] ingest failed:', e.message);
    return json({ ok: false, error: 'Could not save the samples.' }, 500);
  }
}
