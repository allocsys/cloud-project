'use client';
import { useEffect, useRef } from 'react';

// Fades its content in as it scrolls into view. Content already on screen is left alone, and nothing is
// hidden when the device has no IntersectionObserver. The reduced-motion setting is deliberately ignored.
export default function Reveal({ delay = 0, className = '', children }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !('IntersectionObserver' in window)) return undefined;
    if (el.getBoundingClientRect().top < window.innerHeight) return undefined;
    el.classList.add('rv-hide');
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        el.classList.remove('rv-hide');
        io.disconnect();
      },
      { threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={`rv ${className}`.trim()} style={delay ? { transitionDelay: `${delay}ms` } : undefined}>
      {children}
    </div>
  );
}
