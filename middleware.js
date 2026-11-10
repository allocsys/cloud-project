import { NextResponse } from 'next/server';
import { DEFAULT_LANG, LANG_CODES, LANG_COOKIE, stripLang } from '@/lib/i18n/codes';
import { over, addressOf, isTool, LIMITS } from '@/lib/rate-mem';

const KEEP = { path: '/', maxAge: 31536000, sameSite: 'lax' };

// Persian lives under /fa (/fa, /fa/terms, /fa/privacy), Arabic under /ar. Those addresses show the normal page in that language and
// remember it, the same as the language switch. An old ?lang=fa address is sent on to its /fa address.
// Paths that machines call on purpose (the payment gateway, the hall monitoring, uptime checks): no limits, no tool blocking.
const MACHINE = ['/api/payments/webhook', '/api/telemetry', '/api/health'];

// Every API call and every public page passes here first: scraping tools are refused, and one address that sends far more than a
// person could (per minute) is slowed with 429. Calls with no readable address are not limited.
function gate(req, pathname) {
  const api = pathname.startsWith('/api/');
  if (api && (MACHINE.includes(pathname) || pathname.startsWith('/api/bot/'))) return null; // bot calls are signed; an unsigned one costs one cheap check
  const ip = addressOf(req.headers);
  const ua = req.headers.get('user-agent') || '';
  const deny = (status, text) =>
    api
      ? NextResponse.json({ ok: false, error: text }, { status, headers: { 'Cache-Control': 'no-store', ...(status === 429 ? { 'Retry-After': '60' } : {}) } })
      : new NextResponse(text, { status, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' } });
  // An empty user agent is only refused on the API (a browser always sends one); pages stay open to it.
  if (isTool(ua) || (api && !ua)) return deny(403, 'Forbidden.');
  if (!ip) return null;
  const kind = !api ? 'page' : req.method === 'GET' || req.method === 'HEAD' ? 'read' : 'write';
  if (over(`${kind}:${ip}`, LIMITS[kind])) return deny(429, 'Too many requests. Try again in a minute.');
  return null;
}

export function middleware(req) {
  const { pathname } = req.nextUrl;
  const blocked = gate(req, pathname);
  if (blocked) return blocked;
  if (pathname.startsWith('/api/')) return NextResponse.next();
  const base = stripLang(pathname);
  const lang = LANG_CODES.find((l) => l !== DEFAULT_LANG && base !== pathname && (pathname === `/${l}` || pathname.startsWith(`/${l}/`)));
  if (lang) {
    const url = req.nextUrl.clone();
    url.pathname = base;
    const had = req.cookies.get(LANG_COOKIE)?.value;
    req.cookies.set(LANG_COOKIE, lang); // this request already renders in it
    const res = NextResponse.rewrite(url, { request: req });
    if (had !== lang) res.cookies.set(LANG_COOKIE, lang, KEEP); // a visitor who already has it gets no Set-Cookie, so the page can be cached
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
export const config = { matcher: ['/api/:path*', '/', '/terms', '/privacy', '/faq', '/how-it-works', '/glossary', '/about', '/refunds', '/status', '/fa', '/fa/terms', '/fa/privacy', '/fa/faq', '/fa/how-it-works', '/fa/glossary', '/fa/about', '/fa/refunds', '/fa/status', '/ar', '/ar/terms', '/ar/privacy', '/ar/faq', '/ar/how-it-works', '/ar/glossary', '/ar/about', '/ar/refunds', '/ar/status'] };
