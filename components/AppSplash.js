'use client';
import { useEffect, useState } from 'react';
import Splash from '@/components/Splash';
import { inApp } from '@/components/native-splash';

// The Android app opens straight on the dashboard, so the landing page's welcome animation (components/Splash.js) never
// loads there. In the app only, and once per app start (the same session flag as the site), this shows it over the
// signed-in pages. The native start globe stays until the animation's own globe is on screen, then fades into it.
// A browser, and every later page in the same session, renders nothing.
export default function AppSplash() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let seen = true;
    try {
      seen = sessionStorage.getItem('vtx-splash') === '1';
    } catch {}
    if (seen || !inApp()) return;
    window.__vtxAppSplash = true; // components/PWA.js: keep the native globe up, the animation will take over
    setOn(true);
  }, []);
  return on ? <Splash app /> : null;
}
