import Script from 'next/script';
import { Roboto } from 'next/font/google';
import './globals.css';
import PWA from '@/components/PWA';
import Ripple from '@/components/Ripple';
import ThemeSync from '@/components/ThemeSync';
import TelegramInit from '@/components/TelegramInit';

const sans = Roboto({ subsets: ['latin'], weight: ['400', '500'], display: 'swap', variable: '--sans' });

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

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={sans.variable} suppressHydrationWarning>
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
        {children}
        <PWA />
        <Ripple />
        <ThemeSync />
        <TelegramInit />
      </body>
    </html>
  );
}
