import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { DEFAULT_LANG, LANGS, LANG_COOKIE } from '@/lib/i18n/langs';
import { LANG_CODES, DEFAULT_LANG as DEFAULT, LANG_COOKIE as COOKIE, PUBLIC_PAGES, pagePath, stripLang } from '@/lib/i18n/codes';
import { langAlternates } from '@/lib/seo';
import { SITE_URL } from '@/lib/site';
import { middleware, config } from '@/middleware';
import sitemap from '@/app/sitemap';
import robots from '@/app/robots';

const call = (url) => middleware(new NextRequest(`https://x.test${url}`));

test('the light language list matches the registry', () => {
  assert.deepEqual(LANG_CODES, Object.keys(LANGS));
  assert.equal(COOKIE, LANG_COOKIE);
  assert.equal(DEFAULT, DEFAULT_LANG);
});

test('pagePath and stripLang: English is the plain address, Persian is under /fa', () => {
  assert.equal(pagePath('/terms', 'en'), '/terms');
  assert.equal(pagePath('/terms', 'fa'), '/fa/terms');
  assert.equal(pagePath('/', 'fa'), '/fa');
  assert.equal(stripLang('/fa/terms'), '/terms');
  assert.equal(stripLang('/fa'), '/');
  assert.equal(stripLang('/fa/'), '/');
  assert.equal(stripLang('/terms'), '/terms');
  assert.equal(stripLang('/farm'), '/farm');
  assert.equal(stripLang('/dashboard'), '/dashboard');
});

test('langAlternates: canonical follows the language shown, every language is listed', () => {
  const a = langAlternates('/privacy', 'fa');
  assert.equal(a.canonical, `${SITE_URL}/fa/privacy`);
  assert.equal(a.languages.en, `${SITE_URL}/privacy`);
  assert.equal(a.languages.fa, `${SITE_URL}/fa/privacy`);
  assert.equal(a.languages['x-default'], `${SITE_URL}/privacy`);
  assert.equal(langAlternates('/', 'en').canonical, `${SITE_URL}/`);
  assert.equal(langAlternates('/', 'fa').canonical, `${SITE_URL}/fa`);
});

test('middleware: /fa addresses show the normal page in Persian and remember it', () => {
  for (const [from, to] of [['/fa', '/'], ['/fa/terms', '/terms'], ['/fa/privacy', '/privacy']]) {
    const res = call(from);
    assert.equal(new URL(res.headers.get('x-middleware-rewrite')).pathname, to);
    assert.match(res.headers.get('set-cookie'), new RegExp(`${LANG_COOKIE}=fa`));
  }
});

test('middleware: an old ?lang address is sent on to its language address', () => {
  const fa = call('/terms?lang=fa');
  assert.equal(fa.status, 308);
  const to = new URL(fa.headers.get('location'));
  assert.equal(to.pathname, '/fa/terms');
  assert.equal(to.search, '');
  assert.match(fa.headers.get('set-cookie'), new RegExp(`${LANG_COOKIE}=fa`));
  assert.equal(new URL(call('/?lang=fa').headers.get('location')).pathname, '/fa');
  assert.equal(new URL(call('/privacy?lang=en').headers.get('location')).pathname, '/privacy');
});

test('middleware: other addresses and unknown languages are left alone', () => {
  for (const url of ['/', '/terms', '/privacy?lang=xx', '/privacy?ref=abc']) {
    assert.equal(call(url).headers.get('x-middleware-next'), '1', url);
  }
});

test('middleware matcher covers every public page in every language', () => {
  for (const p of PUBLIC_PAGES) {
    for (const l of LANG_CODES) assert.ok(config.matcher.includes(pagePath(p, l)), `${p} ${l}`);
  }
});

test('sitemap: every public page in every language, each with its alternates', () => {
  const list = sitemap();
  assert.equal(list.length, PUBLIC_PAGES.length * LANG_CODES.length);
  assert.equal(list[0].url, `${SITE_URL}/`);
  for (const e of list) {
    assert.ok(e.url.startsWith(SITE_URL));
    assert.equal(Object.keys(e.alternates.languages).length, LANG_CODES.length + 1);
  }
  assert.ok(list.some((e) => e.url === `${SITE_URL}/fa/terms`));
  assert.ok(list.some((e) => e.url === `${SITE_URL}/fa`));
});

test('robots: the API and the admin are closed, the sitemap is named', () => {
  const r = robots();
  assert.deepEqual(r.rules.disallow, ['/api/', '/admin']);
  assert.equal(r.sitemap, `${SITE_URL}/sitemap.xml`);
});
