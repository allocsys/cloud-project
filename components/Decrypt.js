'use client';
import { useEffect, useRef } from 'react';

// Text that starts as encrypted hex digits and resolves into the real words, left to right. The real text is
// always in the markup (readable without JavaScript, and the layout never jumps): while a word is still
// "encrypted" it is only painted over with random digits.
//   when="load" starts once the page has loaded and the browser is idle; when="view" waits until the text scrolls into view.
// One element per word (not per letter): far fewer nodes to hydrate, style and repaint, and it keeps joined
// scripts like Persian intact.
const G = '0123456789ABCDEF';
const SCRAMBLE = /[A-Za-z0-9]/;
const JOINED = /[\u0590-\u08FF]/;
const glyph = () => G[Math.floor(Math.random() * 16)];
const glyphs = (n) => {
  let s = '';
  for (let i = 0; i < n; i += 1) s += glyph();
  return s;
};

export default function Decrypt({ text, when = 'load', delay = 0, pace = 1.5 }) {
  const ref = useRef(null);

  useEffect(() => {
    const root = ref.current;
    const els = root ? Array.from(root.querySelectorAll('.dc')) : [];
    if (!els.length) return undefined;
    let raf = 0;
    let idle = 0;
    let io = null;
    let onDone = null;
    let onLoad = null;
    let dead = false;
    const paint = (e) => {
      e.dataset.g = glyphs(+e.dataset.n || 1);
    };
    const arm = () => {
      els.forEach((e) => {
        paint(e);
        e.classList.add('dc-s');
      });
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

    // Plain load: wait for the page's own load event, then for an idle moment, so the animation never competes
    // with hydration, images or scripts. The text stays readable until it starts.
    const afterLoad = () => {
      const go = () => {
        if (dead) return;
        const start = () => {
          if (dead) return;
          arm();
          run(300);
        };
        if ('requestIdleCallback' in window) idle = window.requestIdleCallback(start, { timeout: 1500 });
        else idle = window.setTimeout(start, 250);
      };
      if (document.readyState === 'complete') go();
      else {
        onLoad = go;
        window.addEventListener('load', onLoad, { once: true });
      }
    };

    if (when === 'view' && 'IntersectionObserver' in window) {
      arm();
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
      arm();
      onDone = () => {
        if (!dead) run(300);
      };
      window.addEventListener('vtx-splash-done', onDone, { once: true });
    } else if (when === 'load') {
      afterLoad();
    } else {
      arm();
      run(300);
    }

    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      if (idle) {
        if ('cancelIdleCallback' in window) window.cancelIdleCallback(idle);
        window.clearTimeout(idle);
      }
      if (onDone) window.removeEventListener('vtx-splash-done', onDone);
      if (onLoad) window.removeEventListener('load', onLoad);
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
