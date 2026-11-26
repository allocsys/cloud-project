'use client';
import { useEffect, useRef } from 'react';

// A number that eases up from zero once, when it appears. The text is written straight into the element
// during the animation, so React does not re-render on every frame. After that it follows `value` untouched,
// so a ticking balance keeps ticking. `format` turns a number into its text.
export default function CountUp({ value, format, ms = 900, delay = 0 }) {
  const ref = useRef(null);
  const latest = useRef(value);
  const fmt = useRef(format);
  const done = useRef(false);
  const first = useRef(null);
  latest.current = value;
  fmt.current = format;
  if (first.current === null) first.current = { __html: format(0) };

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let raf = 0;
    const t0 = performance.now() + delay;
    const tick = (t) => {
      const x = Math.max(0, Math.min(1, (t - t0) / ms));
      const eased = 1 - Math.pow(1 - x, 3);
      el.textContent = fmt.current(latest.current * eased);
      if (x < 1) raf = requestAnimationFrame(tick);
      else done.current = true;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ms, delay]);

  useEffect(() => {
    if (done.current && ref.current) ref.current.textContent = fmt.current(value);
  }, [value]);

  return <span ref={ref} dangerouslySetInnerHTML={first.current} />;
}
