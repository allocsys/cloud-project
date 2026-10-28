// Search engine links for the public pages. Each language has its own address (English plain, Persian under /fa),
// so the canonical and hreflang links in the page can say which is which.
import { LANG_CODES, DEFAULT_LANG, pagePath } from '@/lib/i18n/codes';
import { SITE_URL } from '@/lib/site';

export const pageUrl = pagePath;

// The canonical address of the page in the language it is shown in, and the address in every language (hreflang).
export function langAlternates(path, lang) {
  const abs = (l) => `${SITE_URL}${pagePath(path, l)}`;
  return {
    canonical: abs(lang),
    languages: {
      ...Object.fromEntries(LANG_CODES.map((l) => [l, abs(l)])),
      'x-default': abs(DEFAULT_LANG),
    },
  };
}
