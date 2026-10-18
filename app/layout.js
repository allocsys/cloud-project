import Script from 'next/script';
import { Roboto } from 'next/font/google';
import './globals.css';
import PWA from '@/components/PWA';
import Ripple from '@/components/Ripple';
import ThemeSync from '@/components/ThemeSync';

const sans = Roboto({ subsets: ['latin'], weight: ['400', '500'], display: 'swap', variable: '--sans' });

export const metadata = {
  title: 'Opus Cloud Mining',
  description: 'Rent hash power and mine bitcoin without owning a machine.',
  applicationName: 'Opus',
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
    title: 'Opus Cloud Mining',
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
  colorScheme: 'only light',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={sans.variable} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var m=localStorage.getItem('opus-theme'),l=m==='light'||(m==='system'&&matchMedia('(prefers-color-scheme: light)').matches),d=document.documentElement;d.dataset.theme=l?'light':'dark';d.style.colorScheme='only light'}catch(e){}`,
          }}
        />
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="beforeInteractive"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                if (window.Telegram && window.Telegram.WebApp) {
                  window.Telegram.WebApp.ready();
                  window.Telegram.WebApp.expand();
                  if (window.Telegram.WebApp.setHeaderColor) {
                    window.Telegram.WebApp.setHeaderColor('#12110d');
                  }
                  if (window.Telegram.WebApp.setBackgroundColor) {
                    window.Telegram.WebApp.setBackgroundColor('#12110d');
                  }
                }
              } catch (e) {}
            `,
          }}
        />
      </head>
      <body>
        {children}
        <PWA />
        <Ripple />
        <ThemeSync />
      </body>
    </html>
  );
}
