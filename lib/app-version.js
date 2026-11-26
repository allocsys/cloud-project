'use client';
// The installed Android app's version name. null in a browser or an old app version (no AppUpdater plugin).
import { useEffect, useState } from 'react';

export function useAppVersion() {
  const [name, setName] = useState(null);
  useEffect(() => {
    const p = window.Capacitor?.Plugins?.AppUpdater;
    if (!p) return;
    p.info()
      .then((i) => setName(String(i.name || i.code)))
      .catch(() => {});
  }, []);
  return name;
}
