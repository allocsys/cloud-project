'use client';
import { useEffect, useState } from 'react';
import { AuthButton } from '@/components/AuthSheet';

// A Get started button pinned to the bottom of the landing page from the first screen. It slides away while the
// calculator's own button (or the Boost card's, which shows up once its data has loaded) is on screen (so there are never two buttons),
// and comes back when they scroll out.
// It watches that button instead of the scroll position, so it does not flicker when the phone's address bar
// resizes the screen or the page height changes. It opens the sign-in sheet on Create account.
export default function StickyCta() {
  const [on, setOn] = useState(true);

  useEffect(() => {
    if (!('IntersectionObserver' in window)) return undefined;
    const seen = new Set();
    const vis = new Set();
    const io = new IntersectionObserver((es) => {
      for (const e of es) (e.isIntersecting ? vis.add(e.target) : vis.delete(e.target));
      setOn(vis.size === 0);
    });
    const scan = () => {
      for (const el of document.querySelectorAll('.calc-go, .boost-go')) {
        if (!seen.has(el)) {
          seen.add(el);
          io.observe(el);
        }
      }
    };
    scan();
    const mo = new MutationObserver(scan);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, []);

  return (
    <div className={`lp-sticky${on ? ' on' : ''}`} aria-hidden={!on}>
      <AuthButton mode="signup" className="btn" tabIndex={on ? 0 : -1}>
        Get started
      </AuthButton>
    </div>
  );
}
