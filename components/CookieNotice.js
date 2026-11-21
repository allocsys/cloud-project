'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLang } from '@/components/I18nProvider';
import { PUBLIC_PAGES, pagePath, stripLang } from '@/lib/i18n/codes';

const KEY = 'vtx-cookie-ok';

const CSS = `
.ck-x{position:absolute;top:-14px;inset-inline-end:8px;width:28px;height:28px;display:grid;place-items:center;padding:0;border:1px solid var(--line);border-radius:50%;background:var(--s3);color:var(--mute);cursor:pointer;-webkit-tap-highlight-color:transparent}
.ck-x::after{content:'';position:absolute;inset:-8px}
.ck-x svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
.ck-x:active{background:var(--s4)}
`;

// A small one-time notice on the public pages. We only set essential cookies, so this informs and does not block.
// The answer is kept in this browser; if storage is blocked the notice simply shows again next time.
// While it shows, its height is published as --cookie-h on <html>: the sticky Get started button and the page's bottom padding
// add it, so the notice never covers either of them.
export default function CookieNotice() {
  const { t, lang } = useLang();
  const path = usePathname() || '/';
  const [show, setShow] = useState(false);
  const box = useRef(null);

  useEffect(() => {
    try {
      setShow(!localStorage.getItem(KEY));
    } catch {
      setShow(true);
    }
  }, []);

  const visible = show && PUBLIC_PAGES.includes(stripLang(path));

  useEffect(() => {
    const el = box.current;
    if (!visible || !el) return undefined;
    const root = document.documentElement;
    const set = () => root.style.setProperty('--cookie-h', `${el.offsetHeight + 4}px`);
    set();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(set) : null;
    if (ro) ro.observe(el);
    return () => {
      if (ro) ro.disconnect();
      root.style.removeProperty('--cookie-h');
    };
  }, [visible]);

  if (!visible) return null;

  function ok() {
    try {
      localStorage.setItem(KEY, '1');
    } catch {}
    setShow(false);
  }

  return (
    <div
      ref={box}
      role="region"
      aria-label={t('cookie.text')}
      style={{
        position: 'fixed', insetInline: '12px', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)', zIndex: 60,
        maxWidth: '520px', marginInline: 'auto', display: 'flex', alignItems: 'center', gap: '10px',
        padding: '10px 12px', borderRadius: '12px', background: 'var(--s2)', border: '1px solid var(--line)',
        fontSize: '12.5px', lineHeight: '17px', color: 'var(--mute)', boxShadow: '0 6px 24px rgba(0,0,0,.35)',
      }}
    >
      <style>{CSS}</style>
      <button type="button" className="ck-x" aria-label={t('common.close')} onClick={ok}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
      <span style={{ flex: 1 }}>
        {t('cookie.text')}{' '}
        <Link href={pagePath('/privacy', lang)} style={{ color: 'var(--gold2)' }}>{t('auth.privacy')}</Link>
      </span>
      <button type="button" onClick={ok} style={{ minHeight: '44px', padding: '0 16px', borderRadius: '8px', border: 0, background: 'var(--gold)', color: 'var(--on-gold)', fontWeight: 500, cursor: 'pointer' }}>
        {t('cookie.ok')}
      </button>
    </div>
  );
}
