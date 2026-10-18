'use client';
import { useEffect, useState } from 'react';

// Counts a number up from zero once, when the screen opens.
// After that it returns the live value untouched, so a ticking balance keeps ticking.
export function useCountUp(target, ms = 900) {
  const [p, setP] = useState(0);

  useEffect(() => {
    let raf;
    const t0 = performance.now();
    const tick = (t) => {
      const x = Math.min(1, (t - t0) / ms);
      setP(x);
      if (x < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ms]);

  const eased = 1 - Math.pow(1 - p, 3);
  return target * eased;
}
