import { Roboto, Vazirmatn, Cairo } from 'next/font/google';
import './globals.css';
import './rtl.css';
import AppBack from '@/components/AppBack';
import PWA from '@/components/PWA';
import Ripple from '@/components/Ripple';
import ThemeSync from '@/components/ThemeSync';
import TelegramInit from '@/components/TelegramInit';
import TelegramScript from '@/components/TelegramScript';
import en from '@/lib/i18n/locales/en';
import { SITE_URL } from '@/lib/site';

const sans = Roboto({ subsets: ['latin', 'cyrillic'], weight: ['400', '500'], display: 'swap', variable: '--sans' });
// Persian font: not preloaded, and the browser only fetches it when Persian text is on the page.
const sansFa = Vazirmatn({ subsets: ['arabic', 'latin'], weight: ['400', '500'], display: 'swap', variable: '--sans-fa', preload: false });
// Arabic font: same deal — only fetched when Arabic text is on the page.
const sansAr = Cairo({ subsets: ['arabic', 'latin'], weight: ['400', '500'], display: 'swap', variable: '--sans-ar', preload: false });

// The language and direction are set here, before the first paint, from the address (a /fa page is Persian
// whatever the cookie says) or the language cookie (the app pages have no language in the address). The
// server renders lang="en" dir="ltr" and this corrects it; suppressHydrationWarning on <html> keeps React
// from complaining about the change. The pages themselves render in the same language, so nothing flashes.
const LANG_SCRIPT = `try{var m=location.pathname.match(/^\\/(fa|ar|fi|sv|ru)(\\/|$)/),c=document.cookie.match(/(?:^|; )vtx-lang=([^;]*)/),l=(m&&m[1])||(c&&decodeURIComponent(c[1]))||'en';if(!/^(en|fa|ar|fi|sv|ru)$/.test(l))l='en';var d=document.documentElement;d.lang=l;d.dir=(l==='fa'||l==='ar')?'rtl':'ltr'}catch(e){}`;

// After the first visit in a session the welcome screen is skipped: this marks the page before the first paint so the
// server-rendered splash never shows (components/Splash.js sets the same flag; globals.css hides it).
const SPLASH_SCRIPT = `try{if(sessionStorage.getItem('vtx-splash')==='1')document.documentElement.dataset.sp='off'}catch(e){}`;

export function generateMetadata() {
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: 'Vertexhash', template: '%s · Vertexhash' },
    description: en['meta.description'],
    applicationName: 'Vertexhash',
    verification: { google: 'VTweauBk1nakCwugb3GgdpLxHkkq3dZrezBS7kfbt7Q' },
    openGraph: {
      title: en['meta.og.title'],
      description: en['meta.description'],
      siteName: 'Vertexhash',
      type: 'website',
    },
    twitter: { card: 'summary_large_image' },
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
      title: 'Vertexhash',
    },
    formatDetection: {
      telephone: false,
    },
  };
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0B0F1A',
  colorScheme: 'dark',
};

// Static shell: no cookies, no language lookup, so the pages below it can be static. The language
// provider lives in the group layouts ((site) reads it from the address, (app) and (plain) from the
// cookie) and in the landing and status pages, which stay dynamic.
export default function RootLayout({ children }) {
  return (
    <html lang="en" dir="ltr" className={`${sans.variable} ${sansFa.variable} ${sansAr.variable}`} suppressHydrationWarning>
      <head>
        <meta name="google-site-verification" content="VTweauBk1nakCwugb3GgdpLxHkkq3dZrezBS7kfbt7Q" />
        <script dangerouslySetInnerHTML={{ __html: LANG_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: SPLASH_SCRIPT }} />
        <noscript>
          <style>{'.dc-s{color:inherit}.dc-s::after{display:none}'}</style>
        </noscript>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var m=localStorage.getItem('vtx-theme'),l=m==='light'||(m==='system'&&matchMedia('(prefers-color-scheme: light)').matches),d=document.documentElement;d.dataset.theme=l?'light':'dark';d.style.colorScheme=l?'only light':'dark'}catch(e){}`,
          }}
        />
      </head>
      <body>
        {children}
        <PWA />
        <Ripple />
        <ThemeSync />
        <TelegramScript />
        <TelegramInit />
        <AppBack />
      </body>
    </html>
  );
}
