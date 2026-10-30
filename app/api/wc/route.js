import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// The WalletConnect project id is public (the wallet picker needs it in the browser). Read at run time, so it works even when the build did not see the variable.
export async function GET() {
  const e = process.env;
  return NextResponse.json({ id: e.WC_PROJECT_ID || e.NEXT_PUBLIC_WC_PROJECT_ID || null }, { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } });
}
