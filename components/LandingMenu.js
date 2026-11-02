'use client';
// A small hamburger menu in the top corner of the landing page. Six plain links (the labels come from the server so the page keeps
// its language). It closes on a tap outside, on Escape and on any link.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

export default function LandingMenu({ label, links }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => box.current && !box.current.contains(e.target) && setOpen(false);
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div className="lm" ref={box}>
      <style>{`
        .lm{position:relative}
        .lm-b{display:inline-flex;align-items:center;justify-content:center;width:36px;height:40px;border:0;background:transparent;color:var(--text);cursor:pointer;-webkit-tap-highlight-color:transparent}
        .lm-b svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
        .lm-b:active{opacity:.6}
        .lm-p{position:absolute;z-index:60;top:calc(100% + 4px);right:0;left:auto;min-width:180px;max-width:calc(100vw - 24px);padding:6px;border:1px solid var(--line);border-radius:16px;background:var(--s2);box-shadow:0 8px 24px rgba(0,0,0,.35)}
        [dir=rtl] .lm-p{right:auto;left:0}
        .lm-p a{display:block;padding:11px 14px;border-radius:10px;color:var(--text);font-size:14px;white-space:nowrap}
        .lm-p a:active{background:rgba(var(--gold-rgb),.12)}
      `}</style>
      <button type="button" className="lm-b" aria-label={label} aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d={open ? 'M6 6l12 12M18 6L6 18' : 'M4 7h16M4 12h16M4 17h16'} />
        </svg>
      </button>
      {open && (
        <nav className="lm-p" aria-label={label}>
          {links.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)}>
              {l.label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
