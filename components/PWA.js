'use client';
import { useEffect } from 'react';

// Registers the service worker in production so the app can be installed.
export default function PWA() {
  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);
  return null;
}
