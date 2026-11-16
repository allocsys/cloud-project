import { langFromSegment, staticLangParams, tForLang } from '@/lib/i18n/server';
import { langAlternates } from '@/lib/seo';

// The Terms page is a client component, so its title and language links are set here.
export function generateStaticParams() {
  return staticLangParams();
}

export async function generateMetadata({ params }) {
  const lang = langFromSegment((await params)?.lang);
  const t = tForLang(lang);
  return { title: t('terms.title'), alternates: langAlternates('/terms', lang) };
}

export default function TermsLayout({ children }) {
  return children;
}
