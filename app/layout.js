import { Fraunces, Manrope } from 'next/font/google';
import './globals.css';

const serif = Fraunces({ subsets: ['latin'], variable: '--serif' });
const sans = Manrope({ subsets: ['latin'], variable: '--sans' });

export const metadata = {
  title: 'Opus Cloud Mining',
  description: 'Rent hash power and mine bitcoin without owning a machine.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#070605',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
