'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

const HOME = '/dashboard';

// Android back button: from any screen it lands on Earnings (the entry the app opened on),
// and from Earnings it asks once more, then closes the app.
//
// Chrome skips history entries that a page adds without a tap, so the spare entry
// under the current screen is added on the person's first tap (pointerup / key press),
// not on load. Screen changes replace the entry, so history never grows.
export default function BackGuard() {
  const path = usePathname();
  const pathRef = useRef(path);
  const guarded = useRef(false);
  const timer = useRef(null);
  const [hint, setHint] = useState(false);

  useEffect(() => {
    pathRef.current = path;
  }, [path]);

  useEffect(() => {
    const arm = () => {
      if (guarded.current) return;
      window.history.pushState({ opusGuard: true }, '');
      guarded.current = true;
    };

    const onPop = () => {
      if (!guarded.current) return;
      guarded.current = false;
      // Already on Earnings: the page does not change, so say what the next press does.
      if (pathRef.current === HOME) {
        setHint(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setHint(false), 2000);
      }
    };

    window.addEventListener('pointerup', arm, true);
    window.addEventListener('keydown', arm, true);
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('pointerup', arm, true);
      window.removeEventListener('keydown', arm, true);
      window.removeEventListener('popstate', onPop);
      clearTimeout(timer.current);
    };
  }, []);

  return (
    <div id="exit-toast" className={hint ? 'on' : undefined} role="status" aria-live="polite">
      Press back again to exit
    </div>
  );
}
