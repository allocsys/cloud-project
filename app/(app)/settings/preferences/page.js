'use client';
import { useEffect, useState } from 'react';
import { useToast } from '@/components/Toast';
import { triggerHaptic } from '@/lib/haptics';
import { LangToggle } from '@/components/LangSwitch';
import { useT } from '@/components/I18nProvider';
import { applyTheme, readTheme } from '@/lib/theme';
import { SubHead } from '@/components/SettingsKit';

export default function Preferences() {
  const t = useT();
  const [toast, show] = useToast();
  const [inst, setInst] = useState({ can: false, ios: false, standalone: true });
  const [theme, setTheme] = useState('dark');

  useEffect(() => {
    setTheme(readTheme());
  }, []);

  function pickTheme(v) {
    triggerHaptic('selection');
    setTheme(v);
    applyTheme(v, true);
  }

  // Install button: only when the browser offers the prompt (or on iOS, which needs a hint).
  useEffect(() => {
    const read = () =>
      setInst({
        can: !!window.__vtxInstall,
        ios: /iphone|ipad|ipod/i.test(navigator.userAgent),
        standalone: window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
      });
    read();
    window.addEventListener('vtx-install', read);
    return () => window.removeEventListener('vtx-install', read);
  }, []);

  async function install() {
    triggerHaptic('light');
    const p = window.__vtxInstall;
    if (p) {
      p.prompt();
      try {
        await p.userChoice;
      } catch {}
      window.__vtxInstall = null;
      setInst((s) => ({ ...s, can: false }));
    } else {
      show(t('set.iosHint'));
    }
  }

  return (
    <>
      <SubHead title={t('set.prefs')} />
      <div className="grid wal" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="row" style={{ borderTop: 0 }}>
            <div style={{ fontWeight: 500, fontSize: '13.5px' }}>{t('set.theme')}</div>
            <div className="minitabs" role="group" aria-label={t('set.theme')}>
              {[
                ['dark', 'set.dark'],
                ['light', 'set.light'],
                ['system', 'set.auto'],
              ].map(([v, label]) => (
                <button key={v} type="button" aria-pressed={theme === v} onClick={() => pickTheme(v)}>{t(label)}</button>
              ))}
            </div>
          </div>
          <div className="row">
            <div style={{ fontWeight: 500, fontSize: '13.5px' }}>{t('settings.language')}</div>
            <LangToggle className="set-lang" short />
          </div>
          {!inst.standalone && (inst.can || inst.ios) && (
            <div className="row">
              <div>
                <div style={{ fontWeight: 500, fontSize: '13.5px' }}>{t('set.install')}</div>
                <small>{t('set.installSub')}</small>
              </div>
              <button className="btn ghost" type="button" onClick={install}>{t('set.installBtn')}</button>
            </div>
          )}
        </div>
      </div>
      {toast}
    </>
  );
}
