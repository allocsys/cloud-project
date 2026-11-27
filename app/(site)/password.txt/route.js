import { DECOY_TEXT } from '@/lib/trap';
import { addressOf, over } from '@/lib/rate-mem';
import { sitePost } from '@/lib/site-api';

// A decoy file for scanners and AI agents (see lib/trap.js). Nothing in it is real. The visit is noted in Admin, Overview, Trap hits.
export const dynamic = 'force-dynamic';

export async function GET(req) {
  // Page requests reach this service through Cloudflare, so the right-hand entry of x-forwarded-for is a Cloudflare address, not the visitor.
  // Cloudflare's own header carries the visitor; the older rule stays as the fallback. A wrong value here only misfiles a log line.
  const ip = (req.headers.get('cf-connecting-ip') || '').trim().slice(0, 64) || addressOf(req.headers);
  // One note per address per hour and 60 an hour in all, counted in memory here, so a flood costs the API and the database nothing.
  if (!over(`trap:${ip || '?'}`, 1, 3_600_000) && !over('trap:all', 60, 3_600_000)) {
    sitePost('/api/site/trap', { ip: ip || '', ua: req.headers.get('user-agent') || '' });
  }
  return new Response(DECOY_TEXT, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
}
