// The language codes, the cookie name and the language addresses, kept apart from the message files so middleware.js
// stays small. tests/seo.test.mjs checks that they match the registry in lib/i18n/langs.js.
export const LANG_CODES = ['en', 'fa'];
export const DEFAULT_LANG = 'en';
export const LANG_COOKIE = 'vtx-lang';

// The pages anyone can open signed out. Each has an address per language: /terms in English, /fa/terms in Persian.
export const PUBLIC_PAGES = ['/', '/terms', '/privacy', '/faq', '/how-it-works', '/glossary'];

// '/fa/terms' -> '/terms', '/fa' -> '/'. Any other path comes back as it is.
export function stripLang(path) {
  for (const l of LANG_CODES) {
    if (l === DEFAULT_LANG) continue;
    if (path === `/${l}`) return '/';
    if (path.startsWith(`/${l}/`)) return path.slice(l.length + 1);
  }
  return path;
}

// '/terms' in Persian -> '/fa/terms', '/' -> '/fa'. The default language has no prefix.
export function pagePath(path, lang) {
  if (lang === DEFAULT_LANG) return path;
  return path === '/' ? `/${lang}` : `/${lang}${path}`;
}
