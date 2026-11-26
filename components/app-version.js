'use client';
// The installed Android app's version name.
// null in a browser or an old app version (no AppUpdater plugin).
// '' in the app until the version arrives, so a row can be drawn at once and nothing jumps.
import { useEffect, useLayoutEffect, useState } from 'react';

const useEarly = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export function useAppVersion() {
  const [name, setName] = useState(null);
  useEarly(() => {
    const p = window.Capacitor?.Plugins?.AppUpdater;
    if (!p) return;
    setName('');
    p.info()
      .then((i) => setName(String(i.name || i.code)))
      .catch(() => {});
  }, []);
  return name;
}
