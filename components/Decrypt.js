'use client';
import { useEffect, useRef } from 'react';

// Text that starts as encrypted hex digits and resolves into the real words, left to right. The server already
// renders every word as "encrypted" (class dc-s, fixed digits in data-g), so the page never shows plain text first.
// The real text is still in the markup (search engines, screen readers; a <noscript> rule in the root layout shows
// it when JavaScript is off), the digits are only painted over it. The browser only reveals it.
//   when="load" reveals once the welcome screen has lifted (or at once when there is none);
//   when="view" waits until the text scrolls into view.
// After the first visit in a session the load text stays plain (CSS on html[data-sp=off], set by a head script).
// One element per word (not per letter) for joined scripts like Persian; per letter otherwise.
const G = '0123456789ABCDEF';
const SCRAMBLE = /[A-Za-z0-9]/;
const JOINED = /[\u0590-\u08FF]/;
const glyph = () => G[Math.floor(Math.random() * 16)];
const glyphs = (n) => {
  let s = '';
  for (let i = 0; i < n; i += 1) s += glyph();
  return s;
};
// Fixed digits for the server markup (random ones would not match on the client).
const fixed = (i, n = 1) => {
  let s = '';
  for (let k = 0; k < n; k += 1) s += G[(i * 7 + k * 5 + 3) % 16];
  return s;
};

export default function Decrypt({ text, when = 'load', delay = 0, pace = 0.6 }) {
  const ref = useRef(null);

  useEffect(() => {
    const root = ref.current;
    const els = root ? Array.from(root.querySelectorAll('.dc')) : [];
    if (!els.length) return undefined;
    let raf = 0;
    let io = null;
    let onDone = null;
    let dead = false;

    // After the first visit in a session the welcome screen is skipped (components/Splash.js) and so is the effect here.
    if (when === 'load' && (window.__vtxSeen === true || document.documentElement.dataset.sp === 'off')) {
      els.forEach((e) => e.classList.remove('dc-s'));
      return undefined;
    }

    const paint = (e) => {
      e.dataset.g = glyphs(+e.dataset.n || 1);
    };

    const run = (lead = 300) => {
      const t0 = performance.now() + delay + lead;
      const n = els.length;
      const dur = Math.min(3000, 800 + n * 90) * pace;
      const at = els.map((_, i) => (i / n) * dur + Math.random() * 260);
      const order = at.map((_, i) => i).sort((a, b) => at[a] - at[b]);
      let p = 0;
      let last = 0;
      const tick = (t) => {
        if (dead) return;
        const elapsed = t - t0;
        while (p < n && elapsed >= at[order[p]]) {
          els[order[p]].classList.remove('dc-s');
          p += 1;
        }
        if (t - last > 150) {
          last = t;
          const end = Math.min(n, p + 3);
          for (let k = p; k < end; k += 1) paint(els[order[k]]);
        }
        if (p < n) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };

    if (when === 'view' && 'IntersectionObserver' in window) {
      io = new IntersectionObserver(
        ([e]) => {
          if (!e.isIntersecting) return;
          io.disconnect();
          run();
        },
        { rootMargin: '0px 0px -12% 0px' },
      );
      io.observe(root);
    } else if (when === 'load' && window.__vtxSplash === 'on') {
      // The welcome screen is up: start once it lifts (components/Splash.js).
      onDone = () => {
        if (!dead) run(300);
      };
      window.addEventListener('vtx-splash-done', onDone, { once: true });
    } else {
      run(300);
    }

    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      if (onDone) window.removeEventListener('vtx-splash-done', onDone);
      if (io) io.disconnect();
      els.forEach((e) => e.classList.remove('dc-s'));
    };
  }, [text, when, delay, pace]);

  const words = JOINED.test(text);
  return (
    <span ref={ref} className={when === 'load' ? 'dcl' : undefined}>
      {words
        ? text.split(/(\s+)/).map((w, i) => {
            if (!/\S/.test(w)) return w;
            const n = Math.min(w.length, 8);
            return (
              <span className="dc dc-s" data-n={n} data-g={fixed(i, n)} key={i}>
                {w}
              </span>
            );
          })
        : Array.from(text).map((c, i) =>
            SCRAMBLE.test(c) ? (
              <span className="dc dc-s" data-g={fixed(i)} key={i}>
                {c}
              </span>
            ) : (
              c
            ),
          )}
    </span>
  );
}
