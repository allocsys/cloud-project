import Script from 'next/script';
import { Roboto, Vazirmatn } from 'next/font/google';
import './globals.css';
import './rtl.css';
import PWA from '@/components/PWA';
import Ripple from '@/components/Ripple';
import ThemeSync from '@/components/ThemeSync';
import TelegramInit from '@/components/TelegramInit';
import I18nProvider from '@/components/I18nProvider';
import { getLang } from '@/lib/i18n/server';
import { LANGS } from '@/lib/i18n/langs';

const sans = Roboto({ subsets: ['latin'], weight: ['400', '500'], display: 'swap', variable: '--sans' });
// Persian font: not preloaded, and the browser only fetches it when Persian text is on the page.
const sansFa = Vazirmatn({ subsets: ['arabic', 'latin'], weight: ['400', '500'], display: 'swap', variable: '--sans-fa', preload: false });

export const metadata = {
  title: 'Miner Opus',
  description: 'Rent bitcoin hash power and follow your earnings every day. No hardware, no setup.',
  applicationName: 'Miner Opus',
  openGraph: {
    title: 'Miner Opus: bitcoin mining without the machines',
    description: 'Rent bitcoin hash power and follow your earnings every day. No hardware, no setup.',
    siteName: 'Miner Opus',
    type: 'website',
  },
  icons: {
    icon: [
      { url: '/logo.svg', type: 'image/svg+xml' },
      { url: '/icons/192', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Miner Opus',
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#12110d',
  colorScheme: 'dark',
};

export default async function RootLayout({ children }) {
  const lang = await getLang();
  return (
    <html lang={lang} dir={LANGS[lang].dir} className={`${sans.variable} ${sansFa.variable}`} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var m=localStorage.getItem('opus-theme'),l=m==='light'||(m==='system'&&matchMedia('(prefers-color-scheme: light)').matches),d=document.documentElement;d.dataset.theme=l?'light':'dark';d.style.colorScheme=l?'only light':'dark'}catch(e){}`,
          }}
        />
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="beforeInteractive"
        />
      </head>
      <body>
        <I18nProvider lang={lang}>
          {children}
          <PWA />
          <Ripple />
          <ThemeSync />
          <TelegramInit />
        </I18nProvider>
      </body>
    </html>
  );
}
