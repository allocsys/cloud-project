import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Nav from '@/components/Nav';
import BackGuard from '@/components/BackGuard';
import AssistantLazy from '@/components/AssistantLazy';
import WalletProvider from '@/components/WalletProvider';
import { PendingStrip } from '@/components/PendingOrders';
import MaintenanceStrip from '@/components/MaintenanceStrip';
import AppUpdate from '@/components/AppUpdate';
import I18nProvider from '@/components/I18nProvider';
import CookieNotice from '@/components/CookieNotice';
import { getLang, getT, getMessages } from '@/lib/i18n/server';
import { SESSION_COOKIE } from '@/lib/session-cookie';

// The signed-in pages stay dynamic: the language comes from the cookie, as before.
export async function generateMetadata() {
  const t = await getT();
  return { description: t('meta.description'), openGraph: { description: t('meta.description') } };
}

// No session cookie: the sign-in sheet on the home page, not empty app screens. Only REQUIRE_AUTH=0 (demo with no login) skips this.
export default async function AppLayout({ children }) {
  const jar = await cookies();
  if (!jar.has(SESSION_COOKIE) && process.env.REQUIRE_AUTH !== '0') redirect('/?auth=1');
  const lang = await getLang();
  const messages = await getMessages(lang);
  return (
    <I18nProvider lang={lang} messages={messages}>
      <div id="app">
        <WalletProvider>
          <Nav />
          <main>
            <MaintenanceStrip />
            <AppUpdate />
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
