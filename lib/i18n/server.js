import { cookies } from 'next/headers';
import { LANG_CODES, DEFAULT_LANG } from '@/lib/i18n/codes';
import { LANG_COOKIE, pickLang, translate, getMessages as loadMessages } from '@/lib/i18n/langs';

// For server components and routes: the language comes from the cookie, so the first paint is already in the right language.
export async function getLang() {
  const jar = await cookies();
  return pickLang(jar.get(LANG_COOKIE)?.value);
}

export async function getT() {
  const lang = await getLang();
  return (key, vars) => translate(lang, key, vars);
}

// The active language's messages (English filled in for missing keys) for I18nProvider.
export async function getMessages(lang) {
  return loadMessages(lang ?? (await getLang()));
}

// A translate function bound to a language, for static pages: they cannot read the cookie,
// so the language comes from the address instead (see langFromSegment).
export function tForLang(lang) {
  return (key, vars) => translate(lang, key, vars);
}

// The language of a static page from its [lang] segment: 'fa' is Persian. Anything else is not
// a language: the layout answers 404, so a bad address never renders English to a visitor who
// asked for another language.
export function langFromSegment(seg) {
  const code = Array.isArray(seg) ? seg[0] : seg;
  if (code === undefined) return DEFAULT_LANG;
  return LANG_CODES.includes(code) ? code : null;
}

// generateStaticParams for a [lang] page: one entry per language, English included. The bare
// English address (/terms) is served from its /en/terms route by a middleware rewrite.
export function staticLangParams() {
  return LANG_CODES.map((l) => ({ lang: l }));
}
