import { pagePath } from '@/lib/i18n/codes';

// The links of the public menu, in order: Plans first (the calculator on the landing page; the Plans screen once signed in), then the info pages.
// Used by the landing page and by the header of the info pages (components/SiteTop.js).
export function plansHref(signedIn = false) {
  return signedIn ? '/plans' : '/#calc';
}

export function menuLinks(t, lang, signedIn = false) {
  return [
    { href: plansHref(signedIn), label: t('nav.plans') },
    { href: pagePath('/how-it-works', lang), label: t('how.link') },
    { href: pagePath('/faq', lang), label: t('faq.link') },
    { href: pagePath('/glossary', lang), label: t('glo.link') },
    { href: pagePath('/about', lang), label: t('about.link') },
    { href: pagePath('/refunds', lang), label: t('refunds.link') },
    { href: pagePath('/status', lang), label: t('status.link') },
  ];
}
