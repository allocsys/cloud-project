import { NextResponse } from 'next/server';
import { guarded } from '@/lib/server/shed';

export const dynamic = 'force-dynamic';
export const GET = guarded(GET_);

// The WalletConnect project id is public (the wallet picker needs it in the browser). Read at run time, so it works even when the build did not see the variable.
async function GET_() {
  const e = process.env;
  return NextResponse.json({ id: e.WC_PROJECT_ID || e.NEXT_PUBLIC_WC_PROJECT_ID || null }, { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } });
}
