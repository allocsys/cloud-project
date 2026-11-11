'use client';
// Language dropdown: a button that opens an in-page menu (same pattern as LandingMenu).
// A native <select> opens the OS picker on phones, so the menu is built from plain buttons.
import { useEffect, useRef, useState } from 'react';
import { triggerHaptic } from '@/lib/haptics';
import { LANGS } from '@/lib/i18n/langs';
import { useLang } from '@/components/I18nProvider';

export function LangToggle({ className }) {
  const { lang, setLang, t } = useLang();
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const codes = Object.keys(LANGS);

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
    <div className="lang-drop" ref={box}>
      <style>{`
        .lang-drop{position:relative}
        .lang-drop-b{gap:6px}
        .lang-drop-b svg{flex:none;width:16px;height:16px}
        .lang-menu{position:absolute;z-index:60;top:calc(100% + 4px);right:0;left:auto;min-width:180px;max-width:calc(100vw - 24px);margin:0;padding:6px;border:1px solid var(--line);border-radius:16px;background:var(--s2);box-shadow:0 8px 24px rgba(0,0,0,.35);list-style:none}
        [dir=rtl] .lang-menu{right:auto;left:0}
        .lang-menu button{display:block;width:100%;padding:11px 14px;border:0;border-radius:10px;background:none;color:var(--text);font:inherit;font-size:14px;line-height:20px;text-align:start;white-space:nowrap;cursor:pointer;-webkit-tap-highlight-color:transparent}
        .lang-menu button:active{background:rgba(var(--gold-rgb),.12)}
        .lang-menu li[aria-selected=true] button{color:var(--gold2);font-weight:600}
      `}</style>
      <button
        type="button"
        className={`${className || ''} lang-drop-b`.trim()}
        aria-label={t('settings.language')}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18" />
          <path d="M12 3c2.6 2.7 3.9 5.7 3.9 9s-1.3 6.3-3.9 9c-2.6-2.7-3.9-5.7-3.9-9S9.4 5.7 12 3z" />
        </svg>
        <span>{LANGS[lang].name}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <ul className="lang-menu" role="listbox" aria-label={t('settings.language')}>
          {codes.map((c) => (
            <li key={c} role="option" aria-selected={lang === c}>
              <button
                type="button"
                lang={c}
                onClick={() => {
                  if (c !== lang) {
                    triggerHaptic('selection');
                    setLang(c);
                  }
                  setOpen(false);
                }}
              >
                {LANGS[c].name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
