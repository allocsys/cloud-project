'use client';
import { Fragment, createContext, useContext, useEffect, useLayoutEffect, useMemo } from 'react';
import { DEFAULT_LANG, LANG_META, LANG_COOKIE } from '@/lib/i18n/meta';
import { setClientMessages, translateClient } from '@/lib/i18n/client';
import { PUBLIC_PAGES, pagePath, stripLang } from '@/lib/i18n/codes';

const fallback = { lang: DEFAULT_LANG, dir: 'ltr', t: (key, vars) => translateClient(DEFAULT_LANG, key, vars) };
const Ctx = createContext(fallback);
// Runs before the browser paints (on the server it is a plain effect, which never runs there).
const useBeforePaint = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export default function I18nProvider({ lang, messages, children }) {
  // The server renders <html lang="en" dir="ltr"> and a script in the head corrects it before the first paint (app/layout.js).
  // If React redoes the page on the client it writes the server's values back, which dropped Persian and Arabic to ltr after a
  // second. Setting them here, before paint, from the language this page really renders in, puts them back every time.
  useBeforePaint(() => {
    const el = document.documentElement;
    const dir = LANG_META[lang]?.dir || 'ltr';
    if (el.lang !== lang) el.lang = lang;
    if (el.dir !== dir) el.dir = dir;
  }, [lang]);
  // Register the messages for error translation outside React (lib/api.js). Client only: on the
  // server this module state would be shared across requests. Idempotent, so calling it on every
  // render is safe and keeps the messages in place from the first paint.
  if (typeof window !== 'undefined') setClientMessages(lang, messages);
  const value = useMemo(() => ({ lang, dir: LANG_META[lang]?.dir || 'ltr', t: (key, vars) => translateClient(lang, key, vars) }), [lang, messages]);
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
    if (!LANG_META[code]) return;
    document.cookie = `${LANG_COOKIE}=${code}; path=/; max-age=31536000; samesite=lax`;
    // A language in the address (/fa, ?lang=fa) would put the old language back, so the address changes with it:
    // a public page moves to its address in the new language, any other page keeps its address.
    const u = new URL(window.location.href);
    const here = stripLang(u.pathname);
    u.pathname = PUBLIC_PAGES.includes(here) ? pagePath(here, code) : here;
    u.searchParams.delete('lang');
    window.location.replace(u.toString());
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
