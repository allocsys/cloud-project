// Search engine links for the public pages. The cookie decides the language, so each language also has its own address:
// English is the plain address, the others add ?lang=xx (middleware.js sets the language from it).
import { DEFAULT_LANG } from '@/lib/i18n/langs';
import { LANG_CODES } from '@/lib/i18n/codes';

export const pageUrl = (path, lang) => (lang === DEFAULT_LANG ? path : `${path}?lang=${lang}`);

// The canonical address of the page in the language it is shown in, and the address in every language (hreflang).
export function langAlternates(path, lang) {
  return {
    canonical: pageUrl(path, lang),
    languages: {
      ...Object.fromEntries(LANG_CODES.map((l) => [l, pageUrl(path, l)])),
      'x-default': pageUrl(path, DEFAULT_LANG),
    },
  };
}
