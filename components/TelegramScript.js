'use client';
import Script from 'next/script';

// Loads Telegram's script after the page is interactive and announces it (vtx-tg) when it is ready.
// Splash and TelegramInit wait for that event instead of polling (lib/telegram.js).
export default function TelegramScript() {
  return (
    <Script
      src="https://telegram.org/js/telegram-web-app.js"
      strategy="afterInteractive"
      onReady={() => window.dispatchEvent(new Event('vtx-tg'))}
    />
  );
}
