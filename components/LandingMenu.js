'use client';
// A small hamburger menu in the top corner of the landing page. Plain links (the labels come from the server so the page keeps
// its language), then Contact us, then the social icons (children, rendered by the server). It closes on a tap outside, on Escape and on any link.
// The panel is a div, not a nav: the global nav rule in globals.css is the phone bottom bar and would restyle it.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

const MAIL = 'mailto:support@vertexhash.com';

export default function LandingMenu({ label, links, contact, children }) {
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
        .lm-p{position:absolute;z-index:60;top:calc(100% + 4px);right:0;left:auto;min-width:200px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 80px);overflow-y:auto;padding:6px;border:1px solid var(--line);border-radius:16px;background:var(--s2);box-shadow:0 8px 24px rgba(0,0,0,.35)}
        [dir=rtl] .lm-p{right:auto;left:0}
        .lm-p>a{display:block;padding:11px 14px;border-radius:10px;color:var(--text);font-size:14px;line-height:20px;white-space:nowrap;text-decoration:none}
        .lm-p>a:active{background:rgba(var(--gold-rgb),.12)}
        .lm-sep{height:1px;margin:6px 8px;background:var(--line)}
        .lm-p .lm-soc{margin:4px 0 6px;flex-wrap:wrap}
      `}</style>
      <button type="button" className="lm-b" aria-label={label} aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d={open ? 'M6 6l12 12M18 6L6 18' : 'M4 7h16M4 12h16M4 17h16'} />
        </svg>
      </button>
      {open && (
        <div className="lm-p" role="navigation" aria-label={label}>
          {links.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)}>
              {l.label}
            </Link>
          ))}
          <div className="lm-sep" />
          <a href={MAIL} onClick={() => setOpen(false)}>
            {contact}
          </a>
          {children}
        </div>
      )}
    </div>
  );
}
