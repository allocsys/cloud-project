import { NextResponse } from 'next/server';
import { feedEnabled, checkKey, ingest } from '@/lib/server/telemetry';
import { readCapped } from '@/lib/server/body';
import { clientIp, reserve, giveBack } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

const MAX_BODY = 300_000;

const json = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

// A hall's monitoring posts what its miners hashed:
//   POST /api/telemetry   Authorization: Bearer <TELEMETRY_KEY>
//   { "samples": [{ "serial": "VTX-0004389", "th": 112.4, "at": 1761000000000 }] }   (at is optional, default now)
// Up to 1000 samples per request. Rows that do not pass are skipped and counted in "rejected".
export async function POST(req) {
  if (!feedEnabled()) return json({ ok: false, error: 'The hashrate feed is off. Set TELEMETRY_KEY (16 or more characters) and redeploy.' }, 503);
  const auth = req.headers.get('authorization') || '';
  // Every attempt is counted first; a right key gives it back, so only wrong keys add up (8 in 15 minutes per address).
  const tries = `tel:${clientIp(req)}`;
  if (await reserve(tries)) return json({ ok: false, error: 'Too many attempts. Try again in 15 minutes.' }, 429);
  if (!auth.startsWith('Bearer ') || !checkKey(auth.slice(7).trim())) return json({ ok: false, error: 'Wrong key.' }, 401);
  await giveBack(tries);
  if (Number(req.headers.get('content-length') || 0) > MAX_BODY) return json({ ok: false, error: 'Too large.' }, 413);
  let body;
  try {
    const buf = await readCapped(req, MAX_BODY);
    if (!buf) return json({ ok: false, error: 'Too large.' }, 413);
    body = JSON.parse(buf.toString('utf8'));
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
