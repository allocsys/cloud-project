import { SITE_URL } from '@/lib/site';

// Read at request time so APP_URL is the one the server runs with, not the one at build time.
export const dynamic = 'force-dynamic';

// The signed-in pages are kept out of search results with a noindex header (next.config.mjs), so they stay crawlable
// and the engine can see it. Only the API and the admin screen are closed to crawlers.
export default function robots() {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/admin'] },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
