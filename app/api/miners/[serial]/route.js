import { NextResponse } from 'next/server';
import { getMiner, setRenew } from '@/lib/server/miners';
import { userId, unauthorized } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

export async function GET(req, { params }) {
  const id = await userId(req);
  if (!id) return unauthorized();
  const { serial } = await params;
  const contract = await getMiner(serial, id);
  if (!contract) return NextResponse.json({ error: 'Miner not found.' }, { status: 404 });
  return NextResponse.json({ contract }, { headers: { 'Cache-Control': 'private, no-store' } });
}

// { renew: true | false } turns "Renew at term end" on or off for a Smart Mining miner.
export async function POST(req, { params }) {
  const id = await userId(req);
  if (!id) return unauthorized();
  const { serial } = await params;
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }
  if (typeof body?.renew !== 'boolean') return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  const { status, ...rest } = await setRenew(id, serial, body.renew);
  return NextResponse.json(rest, { status, headers: { 'Cache-Control': 'no-store' } });
}
