'use client';
import { useEffect, useRef } from 'react';

// Text that starts as encrypted hex digits and resolves into the real words, left to right. The real text is
// always in the markup (readable without JavaScript, and the layout never jumps): while a letter is still
// "encrypted" it is only painted over with a random digit.
//   when="load" starts right away; when="view" waits until the text scrolls into view.
const G = '0123456789ABCDEF';
const SCRAMBLE = /[A-Za-z0-9]/;
const glyph = () => G[Math.floor(Math.random() * 16)];

export default function Decrypt({ text, when = 'load', delay = 0, pace = 1 }) {
  const ref = useRef(null);

  useEffect(() => {
    const root = ref.current;
    const els = root ? Array.from(root.querySelectorAll('.dc')) : [];
    if (!els.length) return undefined;
    let raf = 0;
    let io = null;
    let dead = false;

    els.forEach((e) => {
      e.dataset.g = glyph();
      e.classList.add('dc-s');
    });

    const run = () => {
      const t0 = performance.now() + delay + (when === 'load' ? 700 : 300);
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
          const end = Math.min(n, p + 16);
          for (let k = p; k < end; k += 1) els[order[k]].dataset.g = glyph();
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
    } else {
      run();
    }

    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      if (io) io.disconnect();
      els.forEach((e) => e.classList.remove('dc-s'));
    };
  }, [text, when, delay, pace]);

  return (
    <span ref={ref}>
      {Array.from(text).map((c, i) =>
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
