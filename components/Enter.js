'use client';
import { createContext, useContext, useRef, useState } from 'react';

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

// True once value differs from the value at mount. A swap animation keyed on value should play only then: the screen's
// second mount (loading copy, then the real page) starts with the same value, so it does not fade in again.
export function useChanged(value) {
  const first = useRef(value);
  const moved = useRef(false);
  if (value !== first.current) moved.current = true;
  return moved.current;
}
