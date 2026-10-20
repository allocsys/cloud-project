'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

// A Get started button that slides up once the hero has scrolled away, and steps aside near the page end.
export default function StickyCta() {
  const [on, setOn] = useState(false);

  useEffect(() => {
    const f = () => {
      const y = window.scrollY;
      const end = document.documentElement.scrollHeight - window.innerHeight;
      setOn(y > 520 && y < end - 360);
    };
    f();
    window.addEventListener('scroll', f, { passive: true });
    return () => window.removeEventListener('scroll', f);
  }, []);

  return (
    <div className={`lp-sticky${on ? ' on' : ''}`} aria-hidden={!on}>
      <Link href="/login?mode=signup" className="btn" tabIndex={on ? 0 : -1}>
        Get started
      </Link>
    </div>
  );
}
