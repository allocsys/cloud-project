import { getT } from '@/lib/i18n/server';

// The Terms page is a client component, so its title is set here.
export async function generateMetadata() {
  const t = await getT();
  return { title: t('terms.title') };
}

export default function TermsLayout({ children }) {
  return children;
}
