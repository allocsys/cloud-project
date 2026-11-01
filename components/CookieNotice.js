'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLang } from '@/components/I18nProvider';
import { PUBLIC_PAGES, pagePath, stripLang } from '@/lib/i18n/codes';

const KEY = 'vtx-cookie-ok';

// A small one-time notice on the public pages. We only set essential cookies, so this informs and does not block.
// The answer is kept in this browser; if storage is blocked the notice simply shows again next time.
export default function CookieNotice() {
  const { t, lang } = useLang();
  const path = usePathname() || '/';
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      setShow(!localStorage.getItem(KEY));
    } catch {
      setShow(true);
    }
  }, []);

  if (!show || !PUBLIC_PAGES.includes(stripLang(path))) return null;

  function ok() {
    try {
      localStorage.setItem(KEY, '1');
    } catch {}
    setShow(false);
  }

  return (
    <div
      role="region"
      aria-label={t('cookie.text')}
      style={{
        position: 'fixed', insetInline: '12px', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)', zIndex: 60,
        maxWidth: '520px', marginInline: 'auto', display: 'flex', alignItems: 'center', gap: '10px',
        padding: '10px 12px', borderRadius: '12px', background: 'var(--card, #221e12)', border: '1px solid var(--line, #3d3519)',
        fontSize: '12.5px', lineHeight: '17px', color: 'var(--mute, #a89868)', boxShadow: '0 6px 24px rgba(0,0,0,.35)',
      }}
    >
      <span style={{ flex: 1 }}>
        {t('cookie.text')}{' '}
        <Link href={pagePath('/privacy', lang)} style={{ color: 'var(--gold2, #f4e3b0)' }}>{t('auth.privacy')}</Link>
      </span>
      <button type="button" onClick={ok} style={{ padding: '6px 14px', borderRadius: '8px', border: 0, background: 'var(--gold, #e8b84a)', color: '#121110', fontWeight: 500, cursor: 'pointer' }}>
        {t('cookie.ok')}
      </button>
    </div>
  );
}
