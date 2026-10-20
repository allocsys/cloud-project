'use client';
import { useEffect, useRef, useState } from 'react';

// Welcome screen for the landing page. The server renders it visible, so it covers the very first paint (no flash of
// plain text). It lifts once the fonts are ready and a short minimum time has passed; after the first visit in a
// session the minimum is much shorter.
const FIRST = 1100;
const REPEAT = 250;

export default function Splash() {
  const ref = useRef(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    let seen = false;
    try {
      seen = sessionStorage.getItem('opus-splash') === '1';
      sessionStorage.setItem('opus-splash', '1');
    } catch {}
    const t0 = performance.now();
    window.__opusSplash = 'on';
    const fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    let t1 = 0;
    let t2 = 0;
    Promise.race([fonts, new Promise((r) => setTimeout(r, 2500))]).then(() => {
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
