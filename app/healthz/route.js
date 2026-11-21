import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Liveness probe for the web service: 200 while the server answers. It never touches the database or the API, so a page server
// stays "healthy" when the API is down (the pages then show the maintenance bar).
export async function GET() {
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
