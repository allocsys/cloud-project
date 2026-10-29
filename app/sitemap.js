import { SITE_URL } from '@/lib/site';
import { LANG_CODES } from '@/lib/i18n/codes';
import { DEFAULT_LANG } from '@/lib/i18n/langs';
import { pageUrl } from '@/lib/seo';

export const dynamic = 'force-dynamic';

// The pages anyone can open without signing in.
const PAGES = ['/', '/terms', '/privacy', '/faq', '/how-it-works'];

// One entry per page and language; each lists the address in every language (hreflang).
export default function sitemap() {
  const abs = (p, l) => `${SITE_URL}${pageUrl(p, l)}`;
  return PAGES.flatMap((p) =>
    LANG_CODES.map((l) => ({
      url: abs(p, l),
      alternates: {
        languages: {
          ...Object.fromEntries(LANG_CODES.map((x) => [x, abs(p, x)])),
          'x-default': abs(p, DEFAULT_LANG),
        },
      },
    })),
  );
}
