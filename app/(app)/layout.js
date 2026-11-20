import Nav from '@/components/Nav';
import BackGuard from '@/components/BackGuard';
import AssistantLazy from '@/components/AssistantLazy';
import WalletProvider from '@/components/WalletProvider';
import { PendingStrip } from '@/components/PendingOrders';
import MaintenanceStrip from '@/components/MaintenanceStrip';
import I18nProvider from '@/components/I18nProvider';
import CookieNotice from '@/components/CookieNotice';
import { getLang, getT, getMessages } from '@/lib/i18n/server';

// The signed-in pages stay dynamic: the language comes from the cookie, as before.
export async function generateMetadata() {
  const t = await getT();
  return { description: t('meta.description'), openGraph: { description: t('meta.description') } };
}

export default async function AppLayout({ children }) {
  const lang = await getLang();
  const messages = await getMessages(lang);
  return (
    <I18nProvider lang={lang} messages={messages}>
      <div id="app">
        <WalletProvider>
          <Nav />
          <main>
            <MaintenanceStrip />
            <PendingStrip />
            {children}
          </main>
          <BackGuard />
          <AssistantLazy />
        </WalletProvider>
      </div>
      <CookieNotice />
    </I18nProvider>
  );
}
