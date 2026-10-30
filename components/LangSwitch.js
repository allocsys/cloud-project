'use client';
import { triggerHaptic } from '@/lib/haptics';
import { LANGS } from '@/lib/i18n/langs';
import { useLang } from '@/components/I18nProvider';

// Settings: one button per language.
export default function LangSwitch() {
  const { lang, setLang, t } = useLang();
  return (
    <div className="minitabs" role="group" aria-label={t('settings.language')}>
      {Object.entries(LANGS).map(([code, l]) => (
        <button
          key={code}
          type="button"
          lang={code}
          aria-pressed={lang === code}
          onClick={() => {
            if (code === lang) return;
            triggerHaptic('selection');
            setLang(code);
          }}
        >
          {l.name}
        </button>
      ))}
    </div>
  );
}

// Compact switch for the top bar: with two languages one button names the other language; with more it becomes a list.
export function LangToggle({ className }) {
  const { lang, setLang, t } = useLang();
  const codes = Object.keys(LANGS);
  if (codes.length <= 2) {
    const other = codes.find((c) => c !== lang) || codes[0];
    return (
      <button
        type="button"
        lang={other}
        className={`${className || ''} lang-pill`.trim()}
        aria-label={`${t('settings.language')}: ${LANGS[other].name}`}
        onClick={() => {
          triggerHaptic('selection');
          setLang(other);
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18" />
          <path d="M12 3c2.6 2.7 3.9 5.7 3.9 9s-1.3 6.3-3.9 9c-2.6-2.7-3.9-5.7-3.9-9S9.4 5.7 12 3z" />
        </svg>
        <span>{LANGS[other].name}</span>
      </button>
    );
  }
  return (
    <select
      className={className}
      aria-label={t('settings.language')}
      value={lang}
      onChange={(e) => {
        triggerHaptic('selection');
        setLang(e.target.value);
      }}
    >
      {codes.map((c) => (
        <option key={c} value={c} lang={c}>
          {LANGS[c].name}
        </option>
      ))}
    </select>
  );
}
