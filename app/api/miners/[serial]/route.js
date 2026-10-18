import { NextResponse } from 'next/server';
import { getMiner } from '@/lib/server/miners';

export const dynamic = 'force-dynamic';

export async function GET(_req, { params }) {
  const { serial } = await params;
  const contract = getMiner(serial);
  if (!contract) return NextResponse.json({ error: 'Miner not found.' }, { status: 404 });
  return NextResponse.json({ contract }, { headers: { 'Cache-Control': 'private, no-store' } });
}
