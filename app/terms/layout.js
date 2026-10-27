import { getLang, getT } from '@/lib/i18n/server';
import { langAlternates } from '@/lib/seo';

// The Terms page is a client component, so its title and language links are set here.
export async function generateMetadata() {
  const t = await getT();
  const lang = await getLang();
  return { title: t('terms.title'), alternates: langAlternates('/terms', lang) };
}

export default function TermsLayout({ children }) {
  return children;
}
