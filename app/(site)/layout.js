import { notFound } from 'next/navigation';
import I18nProvider from '@/components/I18nProvider';
import CookieNotice from '@/components/CookieNotice';
import { getMessages, langFromSegment } from '@/lib/i18n/server';

// The public pages are static: the language comes from the address ([lang]), never from a cookie,
// so one route prerenders once per language. An address with a segment that is not a language answers
// 404 here instead of rendering English to a visitor who asked for something else.
export const dynamicParams = false;

export default async function SiteLayout({ children, params }) {
  const lang = langFromSegment((await params)?.lang);
  if (!lang) notFound();
  const messages = await getMessages(lang);
  return (
    <I18nProvider lang={lang} messages={messages}>
      {children}
      <CookieNotice />
    </I18nProvider>
  );
}
