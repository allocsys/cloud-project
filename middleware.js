import { NextResponse } from 'next/server';
import { LANG_CODES, LANG_COOKIE } from './lib/i18n/codes';

// A public page opened with ?lang=fa (the address in the sitemap and the hreflang links) shows in that language and
// remembers it, the same as the language switch. Without a valid ?lang the page is left alone.
export function middleware(req) {
  const lang = req.nextUrl.searchParams.get('lang');
  if (!lang || !LANG_CODES.includes(lang)) return NextResponse.next();
  req.cookies.set(LANG_COOKIE, lang); // this request already renders in it
  const res = NextResponse.next({ request: req });
  res.cookies.set(LANG_COOKIE, lang, { path: '/', maxAge: 31536000, sameSite: 'lax' });
  return res;
}

export const config = { matcher: ['/', '/terms', '/privacy'] };
