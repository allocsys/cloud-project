'use client';
import { useRef } from 'react';
import { motion, useScroll, useTransform } from 'motion/react';

// Scroll-driven motion for the landing page (ported from the allocsys portfolio).
// The device's reduced-motion setting is deliberately ignored.

const HEX = 'M50 6L88.1 28L88.1 72L50 94L11.9 72L11.9 28ZM50 26L70.8 38L70.8 62L50 74L29.2 62L29.2 38Z';

/** Gold hexagon chip that turns as the page scrolls. */
export function Spinner() {
  const { scrollY } = useScroll();
  const rotate = useTransform(scrollY, [0, 2400], [0, 360]);
  return (
    <motion.svg className="mo-spin" viewBox="0 0 100 100" aria-hidden="true" style={{ rotate }}>
      <path d={HEX} fill="currentColor" fillRule="evenodd" />
    </motion.svg>
  );
}

function Word({ w, i, n, p }) {
  const o = useTransform(p, [i / n, (i + 1) / n], [0.3, 1]);
  return (
    <>
      <motion.span style={{ opacity: o }}>{w}</motion.span>{' '}
    </>
  );
}

/** Paragraph whose words light up one by one while scrolling. */
export function ScrubText({ text, className }) {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 0.85', 'end 0.55'] });
  const words = text.split(' ');
  return (
    <p ref={ref} className={className}>
      {words.map((w, i) => (
        <Word key={i} w={w} i={i} n={words.length} p={scrollYProgress} />
      ))}
    </p>
  );
}

/** Drifts vertically at its own pace while its box crosses the screen. */
export function Drift({ children, from = 24, to = -24, className }) {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const y = useTransform(scrollYProgress, [0, 1], [from, to]);
  return (
    <motion.div ref={ref} className={className} style={{ y }}>
      {children}
    </motion.div>
  );
}

/** Giant words that slide sideways, in opposite directions, as the page scrolls past. */
export function ScrollWords({ top, bottom }) {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const a = useTransform(scrollYProgress, [0, 1], ['0%', '-40%']);
  const b = useTransform(scrollYProgress, [0, 1], ['-40%', '0%']);
  const rep = (t) => `${t} \u273A `.repeat(4);
  return (
    <div ref={ref} className="mo-words" aria-hidden="true">
      <motion.div className="mo-row" style={{ x: a }}>
        {rep(top)}
      </motion.div>
      <motion.div className="mo-row alt" style={{ x: b }}>
        {rep(bottom)}
      </motion.div>
    </div>
  );
}
