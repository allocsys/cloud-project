import { NextResponse } from 'next/server';
import { getMiner } from '@/lib/server/miners';
import { userId, unauthorized } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

export async function GET(req, { params }) {
  const id = userId(req);
  if (!id) return unauthorized();
  const { serial } = await params;
  const contract = getMiner(serial, id);
  if (!contract) return NextResponse.json({ error: 'Miner not found.' }, { status: 404 });
  return NextResponse.json({ contract }, { headers: { 'Cache-Control': 'private, no-store' } });
}
