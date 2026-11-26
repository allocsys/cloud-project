'use client';
import { useEffect } from 'react';
import { hideNativeSplash } from '@/components/native-splash';

// Registers the service worker in production so the app can be installed, and keeps the
// browser's install prompt so Settings can offer an Install button.
export default function PWA() {
  useEffect(() => {
    // In the Android app a native globe covers the page until it is ready. The welcome screen's own globe says so
    // (components/Splash.js, also over the signed-in pages via components/AppSplash.js); a page without one says so here.
    if ((!document.querySelector('.splash') && !window.__vtxAppSplash) || document.documentElement.dataset.sp === 'off') hideNativeSplash();
  }, []);

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
