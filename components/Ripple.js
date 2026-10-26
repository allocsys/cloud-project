'use client';
import { useEffect } from 'react';

// Material-style press ripple. One listener for the whole app: when a tappable element
// from the list below is pressed, a circle grows out from the touch point and fades.
const SEL =
  '.btn,.swap,.pct-btn,.tabs button,.adm-tabs button,.minitabs button,.linktile,.cl,nav a .ind,.back,.pwtoggle,.upload,.collapse,.bell';

export default function Ripple() {
  useEffect(() => {
    const down = (e) => {
      if (e.button > 0 || !e.target || !e.target.closest) return;
      const host = e.target.closest(SEL);
      if (!host || host.disabled) return;
      const r = host.getBoundingClientRect();
      const size = Math.max(r.width, r.height) * 2;
      const s = document.createElement('span');
      s.className = 'rip';
      s.style.width = `${size}px`;
      s.style.height = `${size}px`;
      s.style.left = `${e.clientX - r.left - size / 2}px`;
      s.style.top = `${e.clientY - r.top - size / 2}px`;
      host.appendChild(s);
      s.addEventListener('animationend', () => s.remove());
    };
    document.addEventListener('pointerdown', down, { passive: true });
    return () => document.removeEventListener('pointerdown', down);
  }, []);
  return null;
}
