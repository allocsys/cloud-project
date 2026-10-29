'use client';
import { useEffect, useRef } from 'react';

// Text that starts as encrypted hex digits and resolves into the real words, left to right. The real text is
// always in the markup (readable without JavaScript, and the layout never jumps): while a letter is still
// "encrypted" it is only painted over with a random digit.
//   when="load" starts right away; when="view" waits until the text scrolls into view.
// Latin text is scrambled letter by letter. Persian and other joined scripts are scrambled word by word,
// because a letter on its own would break the joining.
const G = '0123456789ABCDEF';
const SCRAMBLE = /[A-Za-z0-9]/;
const JOINED = /[\u0590-\u08FF]/;
const glyph = () => G[Math.floor(Math.random() * 16)];
const glyphs = (n) => {
  let s = '';
  for (let i = 0; i < n; i += 1) s += glyph();
  return s;
};

export default function Decrypt({ text, when = 'load', delay = 0, pace = 1 }) {
  const ref = useRef(null);

  useEffect(() => {
    const root = ref.current;
    const els = root ? Array.from(root.querySelectorAll('.dc')) : [];
    if (!els.length) return undefined;
    let raf = 0;
    let io = null;
    let onDone = null;
    let dead = false;
    const paint = (e) => {
      e.dataset.g = glyphs(+e.dataset.n || 1);
    };

    els.forEach((e) => {
      paint(e);
      e.classList.add('dc-s');
    });

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
        if (t - last > 110) {
          last = t;
          const end = Math.min(n, p + 6);
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
      run(when === 'load' ? 700 : 300);
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
    <span ref={ref}>
      {words
        ? text.split(/(\s+)/).map((w, i) =>
            /\S/.test(w) ? (
              <span className="dc" data-n={Math.min(w.length, 8)} key={i}>
                {w}
              </span>
            ) : (
              w
            ),
          )
        : Array.from(text).map((c, i) =>
            SCRAMBLE.test(c) ? (
              <span className="dc" key={i}>
                {c}
              </span>
            ) : (
              c
            ),
          )}
    </span>
  );
}
