'use client';
import { useEffect } from 'react';
import { applyTheme, readTheme } from '@/lib/theme';

// Applies the saved theme on load and follows the system setting when the choice is Auto.
export default function ThemeSync() {
  useEffect(() => {
    applyTheme(readTheme());
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const on = () => {
      if (readTheme() === 'system') applyTheme('system');
    };
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return null;
}
