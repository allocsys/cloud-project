'use client';
import { useEffect } from 'react';

// Tells Telegram the Mini App is ready (until then Telegram keeps its loading screen up), expands it and matches its colours.
// Telegram's script may arrive a moment after the page, so look a few times.
export default function TelegramInit() {
  useEffect(() => {
    let n = 0;
    let t;
    const start = () => {
      const w = window.Telegram && window.Telegram.WebApp;
      if (!w) {
        if (++n < 40) t = setTimeout(start, 250);
        return;
      }
      try {
        w.ready();
        w.expand();
        if (w.setHeaderColor) w.setHeaderColor('#0B0F1A');
        if (w.setBackgroundColor) w.setBackgroundColor('#0B0F1A');
      } catch {}
    };
    start();
    return () => clearTimeout(t);
  }, []);
  return null;
}
