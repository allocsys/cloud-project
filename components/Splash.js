'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

// Welcome screen for the landing page. The server renders it visible, so it covers the very first paint (no flash of
// plain text). While it shows, the page does real work: fonts, the logo and the window load event are awaited, and
// the sign-in routes are prefetched. It lifts when all of that is ready (never later than CAP) and a short minimum
// time has passed; after the first visit in a session the minimum is much shorter.
const FIRST = 1100;
const REPEAT = 250;
const CAP = 2500;

const ready = (p) => p.then(() => {}, () => {});

function loaded() {
  if (document.readyState === 'complete') return Promise.resolve();
  return new Promise((r) => window.addEventListener('load', r, { once: true }));
}

function image(src) {
  return new Promise((r) => {
    const img = new Image();
    img.onload = r;
    img.onerror = r;
    img.src = src;
    if (img.decode) img.decode().then(r, r);
  });
}

function idle() {
  return new Promise((r) => (window.requestIdleCallback ? window.requestIdleCallback(r, { timeout: 600 }) : setTimeout(r, 120)));
}

export default function Splash() {
  const ref = useRef(null);
  const [gone, setGone] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let seen = false;
    try {
      seen = sessionStorage.getItem('opus-splash') === '1';
      sessionStorage.setItem('opus-splash', '1');
    } catch {}
    const t0 = performance.now();
    window.__opusSplash = 'on';
    const fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    try {
      router.prefetch('/login');
    } catch {}
    const work = Promise.all([ready(fonts), ready(loaded()), ready(image('/logo.svg'))]).then(() => idle());
    let t1 = 0;
    let t2 = 0;
    Promise.race([work, new Promise((r) => setTimeout(r, CAP))]).then(() => {
      const wait = Math.max(0, (seen ? REPEAT : FIRST) - (performance.now() - t0));
      t1 = setTimeout(() => {
        if (ref.current) ref.current.classList.add('sp-out');
        window.__opusSplash = 'off';
        window.dispatchEvent(new Event('opus-splash-done'));
        t2 = setTimeout(() => setGone(true), 600);
      }, wait);
    });
    return () => {
      window.__opusSplash = 'off';
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (gone) return null;
  return (
    <div className="sp" ref={ref} aria-hidden="true">
      <noscript>
        <style>{'.sp{display:none}'}</style>
      </noscript>
      <div className="sp-orb">
        <i />
        <i />
        <i />
      </div>
      <div className="sp-name">Miner Opus</div>
    </div>
  );
}
