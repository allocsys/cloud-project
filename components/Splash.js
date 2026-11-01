'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clearApiCache } from '@/lib/api';

// Welcome screen for the landing page. The server renders it visible, so it covers the very first paint (no flash of
// plain text). While it shows, the page does real work: fonts, the logo and the window load event are awaited, and
// the sign-in routes are prefetched. It lifts when all of that is ready (never later than CAP) and a short minimum
// time has passed; after the first visit in a session the minimum is much shorter.
// Inside Telegram, on the first visit of a session, it also asks the server whether this Telegram already has an account
// (it never creates one). If so the person is signed in and sent to the dashboard, and the landing page never shows.
// After a sign-out on purpose (vtx-out) this stays off until the person signs in again.
const FIRST = 1100;
const REPEAT = 250;
const CAP = 2500;
const AUTO = 1700; // a little longer while the account check runs
const CHECK = 4000; // the check gives up after this

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
  const bar = useRef(null);
  const [gone, setGone] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let seen = false;
    try {
      seen = sessionStorage.getItem('vtx-splash') === '1';
      sessionStorage.setItem('vtx-splash', '1');
    } catch {}
    const t0 = performance.now();
    window.__vtxSplash = 'on';
    let out = false;
    try {
      out = localStorage.getItem('vtx-out') === '1';
    } catch {}
    const tg = window.Telegram && window.Telegram.WebApp;
    const auto = !seen && !out && !!(tg && tg.initData);
    let dead = false;
    let check = null;
    if (auto) {
      try {
        router.prefetch('/dashboard');
      } catch {}
      const ctl = new AbortController();
      const stop = setTimeout(() => ctl.abort(), CHECK);
      check = fetch('/api/auth/telegram', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ initData: tg.initData, existing: true }),
        signal: ctl.signal,
      })
        .then((r) => r.ok)
        .catch(() => false)
        .finally(() => clearTimeout(stop));
    }
    const fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    try {
      router.prefetch('/login');
    } catch {}
    // Each finished task moves the bar forward, so what it shows is real progress, not a timer.
    const total = auto ? 6 : 5;
    let done = 1;
    const step = () => {
      done += 1;
      if (bar.current) bar.current.style.transform = `scaleX(${Math.min(1, done / total)})`;
    };
    if (bar.current) bar.current.style.transform = `scaleX(${done / total})`;
    const track = (p) => ready(p).then(step);
    const work = Promise.all([track(fonts), track(loaded()), track(image('/logo.svg')), ...(check ? [track(check)] : [])])
      .then(() => idle())
      .then(step);
    let t1 = 0;
    let t2 = 0;
    Promise.race([work, new Promise((r) => setTimeout(r, CAP))]).then(async () => {
      const signedIn = check ? await check : false;
      if (dead) return;
      if (signedIn) clearApiCache(); // nothing from a previous account may show for this one
      const wait = Math.max(0, (auto ? AUTO : seen ? REPEAT : FIRST) - (performance.now() - t0));
      t1 = setTimeout(() => {
        if (bar.current) bar.current.style.transform = 'scaleX(1)';
        if (signedIn) {
          // The welcome screen stays up until the dashboard takes over. If that never happens, lift it after a while.
          router.replace('/dashboard');
          t2 = setTimeout(() => setGone(true), 6000);
          return;
        }
        if (ref.current) ref.current.classList.add('sp-out');
        window.__vtxSplash = 'off';
        window.dispatchEvent(new Event('vtx-splash-done'));
        t2 = setTimeout(() => setGone(true), 600);
      }, wait);
    });
    return () => {
      dead = true;
      window.__vtxSplash = 'off';
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (gone) return null;
  return (
    <div className="splash" ref={ref} aria-hidden="true">
      <noscript>
        <style>{'.splash{display:none}'}</style>
      </noscript>
      <div className="sp-orb">
        <i />
        <i />
        <i />
      </div>
      <div className="sp-name">Vertexhash</div>
      <div className="sp-track">
        <div className="sp-bar" ref={bar} />
      </div>
    </div>
  );
}
