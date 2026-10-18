import { useEffect, useRef } from 'react';

// Drill-down history: a screen opened from a list (plan miner card to miner page) adds one
// history entry, so back steps out one screen at a time. Tab switches stay flat (replace).
// The depth counter tells BackGuard how many such entries sit above the spare guard entry.

export function markDrill() {
  window.__opusDepth = (window.__opusDepth || 0) + 1;
}

export function drillBack(router, fallback) {
  if ((window.__opusDepth || 0) > 0) window.history.back();
  else router.replace(fallback);
}

// Bottom sheets: while open they own one history entry, so the Android back button
// closes the sheet instead of leaving the page. Closing by button, backdrop or Escape
// removes that entry again.
export function useSheetBack(open, onClose) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    markDrill();
    window.history.pushState({ opusSheet: true }, '');
    let popped = false;
    const onPop = () => {
      popped = true;
      closeRef.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (!popped) window.history.back();
    };
  }, [open]);
}
