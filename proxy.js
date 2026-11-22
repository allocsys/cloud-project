import { NextResponse } from 'next/server';
import { DEFAULT_LANG, LANG_CODES, LANG_COOKIE, STATIC_PAGES } from '@/lib/i18n/codes';
import { over, addressOf, isTool, LIMITS } from '@/lib/rate-mem';
import { edgeOn, fromEdge, fromSvc, edgeFree } from '@/lib/edge';

const KEEP = { path: '/', maxAge: 31536000, sameSite: 'lax' };

// Persian lives under /fa (/fa, /fa/terms, /fa/privacy), Arabic under /ar. Those addresses show the normal page in that language and
// remember it, the same as the language switch. An old ?lang=fa address is sent on to its /fa address.
// Paths that machines call on purpose (the payment gateway, the hall monitoring, uptime checks): no limits, no tool blocking.
const MACHINE = ['/api/payments/webhook', '/api/telemetry', '/api/health'];

// Every API call and every public page passes here first: scraping tools are refused, and one address that sends far more than a
// person could (per minute) is slowed with 429. Calls with no readable address are not limited.
function gate(req, pathname) {
  const api = pathname.startsWith('/api/');
  // With API_EDGE_SECRET set, an API call that did not come through the Worker is refused (health check and signed machine calls excepted).
  // The web service reads /api/site/* directly (not through the Worker) with its service secret.
  if (api && edgeOn() && !edgeFree(pathname) && !fromEdge(req.headers) && !(pathname.startsWith('/api/site/') && fromSvc(req.headers))) return NextResponse.json({ ok: false, error: 'Forbidden.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
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

export function proxy(req) {
  const { pathname } = req.nextUrl;
  const blocked = gate(req, pathname);
  if (blocked) return blocked;
  if (pathname.startsWith('/api/')) return NextResponse.next();
  // A language address (/fa/terms) is a real route: the page renders in that language from the
  // address. The cookie is still remembered, so the app pages (which have no language in the
  // address) open in the same language afterwards. A language address over a page that is not
  // static (/fa/status) renders from its bare address with the cookie set, as before: the page
  // itself is dynamic and reads the cookie.
  const prefixed = LANG_CODES.find((l) => l !== DEFAULT_LANG && pathname.startsWith(`/${l}/`));
  if (prefixed) {
    const rest = pathname.slice(prefixed.length + 1); // '/fa/terms' -> '/terms', '/fa/status' -> '/status'
    const had = req.cookies.get(LANG_COOKIE)?.value;
    if (STATIC_PAGES.includes(rest)) {
      const res = NextResponse.next();
      if (had !== prefixed) res.cookies.set(LANG_COOKIE, prefixed, KEEP); // a visitor who already has it gets no Set-Cookie, so the page can be cached
      return res;
    }
    const url = req.nextUrl.clone();
    url.pathname = rest;
    req.cookies.set(LANG_COOKIE, prefixed); // this request already renders in it
    const res = NextResponse.rewrite(url, { request: req });
    if (had !== prefixed) res.cookies.set(LANG_COOKIE, prefixed, KEEP);
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
  // A bare language root (/fa) is the landing page in that language. The landing stays dynamic,
  // so it renders from / with the cookie set, as before.
  const rootLang = LANG_CODES.find((l) => l !== DEFAULT_LANG && pathname === `/${l}`);
  if (rootLang) {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    const had = req.cookies.get(LANG_COOKIE)?.value;
    req.cookies.set(LANG_COOKIE, rootLang); // this request already renders in it
    const res = NextResponse.rewrite(url, { request: req });
    if (had !== rootLang) res.cookies.set(LANG_COOKIE, rootLang, KEEP);
    return res;
  }
  // A bare public page (/terms) is served from its English route (/en/terms): the page is static,
  // and the address the visitor sees does not change. The landing and the status page stay
  // dynamic, so they are not rewritten.
  if (STATIC_PAGES.includes(pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = `/en${pathname}`;
    return NextResponse.rewrite(url);
  }
  return NextResponse.next();
}

// A literal list (Next reads it at build time). tests/seo.test.mjs checks it covers every public page in every language.
export const config = { matcher: ['/api/:path*', '/', '/terms', '/privacy', '/faq', '/how-it-works', '/glossary', '/about', '/refunds', '/status', '/fa', '/fa/terms', '/fa/privacy', '/fa/faq', '/fa/how-it-works', '/fa/glossary', '/fa/about', '/fa/refunds', '/fa/status', '/ar', '/ar/terms', '/ar/privacy', '/ar/faq', '/ar/how-it-works', '/ar/glossary', '/ar/about', '/ar/refunds', '/ar/status', '/fi', '/fi/terms', '/fi/privacy', '/fi/faq', '/fi/how-it-works', '/fi/glossary', '/fi/about', '/fi/refunds', '/fi/status', '/sv', '/sv/terms', '/sv/privacy', '/sv/faq', '/sv/how-it-works', '/sv/glossary', '/sv/about', '/sv/refunds', '/sv/status', '/ru', '/ru/terms', '/ru/privacy', '/ru/faq', '/ru/how-it-works', '/ru/glossary', '/ru/about', '/ru/refunds', '/ru/status'] };
