'use client';
// The landing page's Get started button: press and hold, a gold fill sweeps across while the label scrambles into hex
// digits and resolves into the real words. When it is full the sign-in sheet opens. A keyboard or screen-reader click
// (detail 0) opens it straight away, so nobody has to hold. The fill is a scaled layer, not an inline-size rule, so it
// works in older in-app browsers and flips for right-to-left.
import { useEffect, useRef } from 'react';
import { useAuthSheet } from '@/components/AuthSheet';
import { useT } from '@/components/I18nProvider';
import { triggerHaptic } from '@/lib/haptics';

const HEX = '0123456789abcdef';
const HOLD_MS = 700;

export default function HoldButton({ mode = 'signup', className = '', ...rest }) {
  const t = useT();
  const { open } = useAuthSheet();
  const btn = useRef(null);
  const fill = useRef(null);
  const txt = useRef(null);
  const run = useRef({ raf: 0, t0: 0, done: false, timer: 0 });
  const label = t('common.holdStart');

  const paint = (p) => {
    if (!fill.current || !txt.current || !btn.current) return;
    fill.current.style.transform = `scaleX(${p})`;
    btn.current.style.color = p > 0.5 ? 'var(--on-gold)' : '';
    if (p === 0) {
      txt.current.textContent = label;
      return;
    }
    const chars = Array.from(label);
    const n = Math.floor(p * chars.length);
    txt.current.textContent = chars
      .map((c, i) => (c === ' ' || i < n ? c : HEX[Math.floor(Math.random() * 16)]))
      .join('');
  };

  const finish = () => {
    const r = run.current;
    if (r.done) return;
    r.done = true;
    triggerHaptic('medium');
    open(mode);
    r.timer = window.setTimeout(() => {
      r.done = false;
      paint(0);
    }, 700);
  };

  const step = (now) => {
    const r = run.current;
    const p = Math.min(1, (now - r.t0) / HOLD_MS);
    paint(p);
    if (p >= 1) {
      finish();
      return;
    }
    r.raf = requestAnimationFrame(step);
  };

  const start = (e) => {
    const r = run.current;
    if (r.done || (e.button !== undefined && e.button > 0)) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    triggerHaptic('selection');
    r.t0 = performance.now();
    r.raf = requestAnimationFrame(step);
  };

  const stop = () => {
    const r = run.current;
    if (r.done) return;
    cancelAnimationFrame(r.raf);
    paint(0);
  };

  useEffect(() => {
    const r = run.current;
    return () => {
      cancelAnimationFrame(r.raf);
      clearTimeout(r.timer);
    };
  }, []);

  return (
    <button
      type="button"
      ref={btn}
      className={`hold ${className}`}
      aria-label={t('common.getStarted')}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => {
        if (e.detail === 0) finish();
      }}
      {...rest}
    >
      <span className="hold-f" ref={fill} aria-hidden="true" />
      <span className="hold-t" ref={txt} aria-hidden="true">{label}</span>
    </button>
  );
}
