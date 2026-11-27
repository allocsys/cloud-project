'use client';
// Inside the Android app only (the @capacitor/app plugin; a browser or an older app has none, so nothing happens).
// Android's Back button steps through the page history, as in the installed web app (components/BackGuard.js then works there too),
// and closes the app when there is nothing left to go back to. With a listener added, the plugin leaves all of this to the page.
import { useEffect } from 'react';

export default function AppBack() {
  useEffect(() => {
    const c = window.Capacitor;
    if (!c?.isNativePlatform?.() || !c.isPluginAvailable?.('App')) return undefined;
    const app = c.Plugins?.App;
    if (!app) return undefined;
    let gone = false;
    let sub = null;
    (async () => {
      try {
        const h = await app.addListener('backButton', ({ canGoBack }) => {
          if (canGoBack) window.history.back();
          else app.exitApp();
        });
        if (gone) h?.remove?.();
        else sub = h;
      } catch {}
    })();
    return () => {
      gone = true;
      sub?.remove?.();
    };
  }, []);

  return null;
}
