'use client';
import AppUpdate from '@/components/AppUpdate';
import { useAppVersion } from '@/lib/app-version';
import { useT } from '@/components/I18nProvider';
import { SubHead } from '@/components/SettingsKit';

export default function About() {
  const t = useT();
  const version = useAppVersion();
  return (
    <>
      <SubHead title={t('set.about')} />
      <AppUpdate always />
      <div className="grid wal" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="row" style={{ borderTop: 0 }}>
            <div className="set-t">{t('set.version')}</div>
            <span dir="ltr">{version || '—'}</span>
          </div>
        </div>
      </div>
    </>
  );
}
