'use client';
import { Fragment, createContext, useContext, useMemo } from 'react';
import { DEFAULT_LANG, LANGS, LANG_COOKIE, translate } from '@/lib/i18n/langs';

const fallback = { lang: DEFAULT_LANG, dir: 'ltr', t: (key, vars) => translate(DEFAULT_LANG, key, vars) };
const Ctx = createContext(fallback);

export default function I18nProvider({ lang, children }) {
  const value = useMemo(() => ({ lang, dir: LANGS[lang]?.dir || 'ltr', t: (key, vars) => translate(lang, key, vars) }), [lang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// t('key', { name: 'x' })
export function useT() {
  return useContext(Ctx).t;
}

// { lang, dir, t, setLang }: setLang saves the cookie and reloads, so the server renders the whole page in the new language.
export function useLang() {
  const c = useContext(Ctx);
  function setLang(code) {
    if (!LANGS[code]) return;
    document.cookie = `${LANG_COOKIE}=${code}; path=/; max-age=31536000; samesite=lax`;
    window.location.reload();
  }
  return { ...c, setLang };
}

// Puts elements (links, bold text) into a sentence: fill(t('auth.agree'), { terms: <Link .../>, privacy: <Link .../> })
// where the text holds {terms} and {privacy}. The word order then follows each language.
export function fill(text, nodes) {
  return String(text)
    .split(/\{(\w+)\}/g)
    .map((part, i) => (i % 2 ? <Fragment key={i}>{nodes[part]}</Fragment> : part));
}
