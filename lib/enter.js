'use client';
import { createContext, useContext, useState } from 'react';

// The card entrance (.rise) should play once per visit. A screen can mount twice in a row: its loading copy first, then the real
// page. The second mount must not start from invisible again, or the screen blinks. app/(app)/template.js makes one marker per
// navigation (it sits above the loading boundary), and the first screen to ask takes the entrance.
export const EnterCtx = createContext(null);

export function useEnterOnce() {
  const ctx = useContext(EnterCtx);
  const [enter] = useState(() => {
    if (!ctx) return true;
    if (ctx.played) return false;
    ctx.played = true;
    return true;
  });
  return enter;
}
