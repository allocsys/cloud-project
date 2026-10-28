import { NextResponse } from 'next/server';
import { DEFAULT_LANG, LANG_CODES, LANG_COOKIE, stripLang } from './lib/i18n/codes';

const KEEP = { path: '/', maxAge: 31536000, sameSite: 'lax' };

// Persian lives under /fa (/fa, /fa/terms, /fa/privacy). Those addresses show the normal page in that language and
// remember it, the same as the language switch. An old ?lang=fa address is sent on to its /fa address.
export function middleware(req) {
  const { pathname } = req.nextUrl;
  const base = stripLang(pathname);
  const lang = LANG_CODES.find((l) => l !== DEFAULT_LANG && base !== pathname && (pathname === `/${l}` || pathname.startsWith(`/${l}/`)));
  if (lang) {
    const url = req.nextUrl.clone();
    url.pathname = base;
    req.cookies.set(LANG_COOKIE, lang); // this request already renders in it
    const res = NextResponse.rewrite(url, { request: req });
    res.cookies.set(LANG_COOKIE, lang, KEEP);
    return res;
  }
  const q = req.nextUrl.searchParams.get('lang');
  if (q && LANG_CODES.includes(q)) {
    const url = req.nextUrl.clone();
    url.searchParams.delete('lang');
    url.pathname = q === DEFAULT_LANG ? pathname : `/${q}${pathname === '/' ? '' : pathname}`;
    const res = NextResponse.redirect(url, 308);
    res.cookies.set(LANG_COOKIE, q, KEEP);
    return res;
  }
  return NextResponse.next();
}

// A literal list (Next reads it at build time). tests/seo.test.mjs checks it covers every public page in every language.
export const config = { matcher: ['/', '/terms', '/privacy', '/fa', '/fa/terms', '/fa/privacy'] };
