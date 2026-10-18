'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

const HOME = '/dashboard';

// Android back button: from any screen go to Earnings, from Earnings ask once more, then exit.
// Works by keeping one spare history entry on top, so a back press can be caught.
export default function BackGuard() {
  const path = usePathname();
  const router = useRouter();
  const pathRef = useRef(path);
  const guarded = useRef(false);
  const timer = useRef(null);
  const [hint, setHint] = useState(false);

  const arm = () => {
    if (guarded.current) return;
    window.history.pushState({ opusGuard: true }, '');
    guarded.current = true;
  };

  // Re-arms after every screen change (navigation replaces entries, so history never grows).
  useEffect(() => {
    pathRef.current = path;
    arm();
  }, [path]);

  useEffect(() => {
    const onPop = () => {
      if (!guarded.current) return;
      guarded.current = false;
      if (pathRef.current !== HOME) {
        router.replace(HOME);
      } else {
        setHint(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          setHint(false);
          arm();
        }, 2000);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      clearTimeout(timer.current);
    };
  }, [router]);

  return (
    <div id="exit-toast" className={hint ? 'on' : undefined} role="status" aria-live="polite">
      Press back again to exit
    </div>
  );
}
