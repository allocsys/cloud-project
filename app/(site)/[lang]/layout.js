import SiteTop from '@/components/SiteTop';
import { langFromSegment } from '@/lib/i18n/server';

// Every info page (Terms, Privacy, About, FAQ, ...) gets the same top bar: the brand takes you home, plus the language and the menu.
export default async function LangLayout({ children, params }) {
  const lang = langFromSegment((await params)?.lang) || 'en';
  return (
    <>
      <SiteTop lang={lang} />
      {children}
    </>
  );
}
