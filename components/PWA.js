'use client';
import { useEffect } from 'react';
import { hideNativeSplash, inApp } from '@/components/native-splash';

// Registers the service worker in production so the app can be installed, and keeps the
// browser's install prompt so Settings can offer an Install button.
export default function PWA() {
  useEffect(() => {
    // In the Android app a native globe covers the page until it is ready. The welcome screen's own globe says so
    // (components/Splash.js, also over the signed-in pages via components/AppSplash.js); a page without one says so here.
    // The decision is made here, at once, not left to a later effect of components/AppSplash.js (that order varied from start
    // to start, and the globe sometimes left before the animation was up). In the app, on the first start of a session, the
    // animation is coming, so the globe stays. If it never shows (a page without it), the globe leaves after a few seconds.
    const splash = () => !!document.querySelector('.splash');
    if (document.documentElement.dataset.sp === 'off') {
      hideNativeSplash();
      return undefined;
    }
    let seen = true;
    try {
      seen = sessionStorage.getItem('vtx-splash') === '1';
    } catch {}
    if (!splash() && !window.__vtxAppSplash && !(inApp() && !seen)) {
      hideNativeSplash();
      return undefined;
    }
    const t = setTimeout(() => {
      if (!splash()) hideNativeSplash();
    }, 3000);
    return () => clearTimeout(t);
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
