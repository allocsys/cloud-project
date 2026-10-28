// Search engine links for the public pages. The cookie decides the language, so each language also has its own address:
// English is the plain address, the others add ?lang=xx (middleware.js sets the language from it).
import { DEFAULT_LANG } from '@/lib/i18n/langs';
import { LANG_CODES } from '@/lib/i18n/codes';
import { SITE_URL } from '@/lib/site';

export const pageUrl = (path, lang) => (lang === DEFAULT_LANG ? path : `${path}?lang=${lang}`);

// The canonical address of the page in the language it is shown in, and the address in every language (hreflang).
// Full addresses: Next drops the ?lang part of a relative one.
export function langAlternates(path, lang) {
  const abs = (l) => `${SITE_URL}${pageUrl(path, l)}`;
  return {
    canonical: abs(lang),
    languages: {
      ...Object.fromEntries(LANG_CODES.map((l) => [l, abs(l)])),
      'x-default': abs(DEFAULT_LANG),
    },
  };
}
