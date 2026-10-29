'use client';
import { useEffect } from 'react';

// Registers the service worker in production so the app can be installed, and keeps the
// browser's install prompt so Settings can offer an Install button.
export default function PWA() {
  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    const changed = () => window.dispatchEvent(new Event('vtx-install'));
    const onPrompt = (e) => {
      e.preventDefault();
      window.__vtxInstall = e;
      changed();
    };
    const onInstalled = () => {
      window.__vtxInstall = null;
      changed();
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);
  return null;
}
