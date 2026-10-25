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
        className={className}
        onClick={() => {
          triggerHaptic('selection');
          setLang(other);
        }}
      >
        {LANGS[other].name}
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
