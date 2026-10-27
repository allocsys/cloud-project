import test from 'node:test';
import assert from 'node:assert/strict';
import { LANGS, LANG_COOKIE } from '@/lib/i18n/langs';
import { LANG_CODES, LANG_COOKIE as COOKIE } from '@/lib/i18n/codes';
import { langAlternates, pageUrl } from '@/lib/seo';
import { SITE_URL } from '@/lib/site';
import sitemap from '@/app/sitemap';
import robots from '@/app/robots';

test('the light language list matches the registry', () => {
  assert.deepEqual(LANG_CODES, Object.keys(LANGS));
  assert.equal(COOKIE, LANG_COOKIE);
});

test('pageUrl: English is the plain address, the others add ?lang', () => {
  assert.equal(pageUrl('/terms', 'en'), '/terms');
  assert.equal(pageUrl('/terms', 'fa'), '/terms?lang=fa');
  assert.equal(pageUrl('/', 'fa'), '/?lang=fa');
});

test('langAlternates: canonical follows the language shown, every language is listed', () => {
  const a = langAlternates('/privacy', 'fa');
  assert.equal(a.canonical, '/privacy?lang=fa');
  assert.equal(a.languages.en, '/privacy');
  assert.equal(a.languages.fa, '/privacy?lang=fa');
  assert.equal(a.languages['x-default'], '/privacy');
  assert.equal(langAlternates('/', 'en').canonical, '/');
});

test('sitemap: every public page in every language, each with its alternates', () => {
  const list = sitemap();
  assert.equal(list.length, 3 * LANG_CODES.length);
  assert.equal(list[0].url, `${SITE_URL}/`);
  for (const e of list) {
    assert.ok(e.url.startsWith(SITE_URL));
    assert.equal(Object.keys(e.alternates.languages).length, LANG_CODES.length + 1);
  }
  assert.ok(list.some((e) => e.url === `${SITE_URL}/terms?lang=fa`));
});

test('robots: the API and the admin are closed, the sitemap is named', () => {
  const r = robots();
  assert.deepEqual(r.rules.disallow, ['/api/', '/admin']);
  assert.equal(r.sitemap, `${SITE_URL}/sitemap.xml`);
});
