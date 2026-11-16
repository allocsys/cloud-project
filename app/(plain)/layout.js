import I18nProvider from '@/components/I18nProvider';
import CookieNotice from '@/components/CookieNotice';
import { getLang, getMessages } from '@/lib/i18n/server';

// Pages without the app chrome (sign-in redirect, verification, admin, reviewers): the language
// still comes from the cookie, as before, so they stay dynamic.
export default async function PlainLayout({ children }) {
  const lang = await getLang();
  const messages = await getMessages(lang);
  return (
    <I18nProvider lang={lang} messages={messages}>
      {children}
      <CookieNotice />
    </I18nProvider>
  );
}
