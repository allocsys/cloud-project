import { NextResponse } from 'next/server';
import { minDeposit, minWithdraw } from '@/lib/server/flags';
import { guarded } from '@/lib/server/shed';

export const dynamic = 'force-dynamic';
export const GET = guarded(GET_);

// The live minimum deposit and withdrawal (admin Settings), for the FAQ answers. {} when they cannot be read: the page then uses
// the built-in numbers.
async function GET_() {
  try {
    const [d, w] = await Promise.all([minDeposit(), minWithdraw()]);
    return NextResponse.json({ minDeposit: d, minWithdraw: w }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({}, { headers: { 'Cache-Control': 'no-store' } });
  }
}
