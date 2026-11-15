'use client';
import { useEffect } from 'react';
import { telegramReady } from '@/lib/telegram';

// Tells Telegram the Mini App is ready (until then Telegram keeps its loading screen up), expands it and matches its colours.
// Telegram's script arrives a moment after the page: wait for its ready event (up to 10s), no polling.
export default function TelegramInit() {
  useEffect(() => {
    let dead = false;
    telegramReady(10000).then((w) => {
      if (dead || !w) return;
      try {
        w.ready();
        w.expand();
        if (w.setHeaderColor) w.setHeaderColor('#0B0F1A');
        if (w.setBackgroundColor) w.setBackgroundColor('#0B0F1A');
      } catch {}
    });
    return () => {
      dead = true;
    };
  }, []);
  return null;
}
