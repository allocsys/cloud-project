import { SITE_URL } from '@/lib/site';

// The TON Connect manifest: the wallet (Tonkeeper) reads it to show who is asking to connect. It must be public and open to any origin.
// The icon is a PNG (wallets do not take SVG).
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(
    { url: SITE_URL, name: 'Vertexhash', iconUrl: `${SITE_URL}/icons/apple` },
    { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' } }
  );
}
