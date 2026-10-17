import Script from 'next/script';
import { Fraunces, Manrope } from 'next/font/google';
import './globals.css';

const serif = Fraunces({ subsets: ['latin'], variable: '--serif' });
const sans = Manrope({ subsets: ['latin'], variable: '--sans' });

export const metadata = {
  title: 'Opus Cloud Mining',
  description: 'Rent hash power and mine bitcoin without owning a machine.',
  applicationName: 'Opus',
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
  themeColor: '#070605',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable}`}>
      <head>
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
                    window.Telegram.WebApp.setHeaderColor('#070605');
                  }
                  if (window.Telegram.WebApp.setBackgroundColor) {
                    window.Telegram.WebApp.setBackgroundColor('#070605');
                  }
                }
              } catch (e) {}
            `,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
