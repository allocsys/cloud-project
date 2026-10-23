'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

// A Get started button pinned to the bottom of the landing page from the first screen. It slides away while the
// calculator's own button is on screen (so there are never two buttons), and comes back when that scrolls out.
// It watches that button instead of the scroll position, so it does not flicker when the phone's address bar
// resizes the screen or the page height changes.
export default function StickyCta() {
  const [on, setOn] = useState(true);

  useEffect(() => {
    const target = document.querySelector('.calc-go');
    if (!target || !('IntersectionObserver' in window)) return undefined;
    const io = new IntersectionObserver(([e]) => setOn(!e.isIntersecting));
    io.observe(target);
    return () => io.disconnect();
  }, []);

  return (
    <div className={`lp-sticky${on ? ' on' : ''}`} aria-hidden={!on}>
      <Link href="/login?mode=signup" className="btn" tabIndex={on ? 0 : -1}>
        Get started
      </Link>
    </div>
  );
}
