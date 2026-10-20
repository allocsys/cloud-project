'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

// A Get started button that slides up once the hero buttons have scrolled out of view, and stays until they
// are back. It watches the hero buttons instead of the scroll position, so it does not flicker when the
// phone's address bar resizes the screen or the page height changes.
export default function StickyCta() {
  const [on, setOn] = useState(false);

  useEffect(() => {
    const target = document.querySelector('.lp-cta');
    if (!target || !('IntersectionObserver' in window)) return undefined;
    const io = new IntersectionObserver(([e]) => setOn(!e.isIntersecting && e.boundingClientRect.top < 0));
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
