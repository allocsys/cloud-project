import { NextResponse } from 'next/server';
import { ask } from '@/lib/server/assistant-service';
import { userId, unauthorized } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

const HEADERS = { 'Cache-Control': 'private, no-store' };
const MAX_BODY = 4000; // characters; the question itself is cut to 500 later

const fail = (error, status) => NextResponse.json({ error }, { status, headers: HEADERS });

// Ask Miner Opus. Read-only: answers from the signed-in user's own data. The question is never logged or stored.
export async function POST(req) {
  const id = await userId(req);
  if (!id) return unauthorized();

  let question = '';
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY) return fail('Question too long', 413);
    const body = JSON.parse(raw);
    question = typeof body?.question === 'string' ? body.question : '';
  } catch {
    return fail('Bad request', 400);
  }
  if (!question.trim()) return fail('Question required', 400);

  try {
    return NextResponse.json(await ask(id, question), { headers: HEADERS });
  } catch (e) {
    console.error('[assistant] failed:', e?.name || 'error');
    return fail('Assistant unavailable', 500);
  }
}
