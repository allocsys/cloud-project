'use client';
import { triggerHaptic } from '@/lib/haptics';
import { LANGS } from '@/lib/i18n/langs';
import { useLang } from '@/components/I18nProvider';

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
