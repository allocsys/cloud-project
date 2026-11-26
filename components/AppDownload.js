'use client';
// "Android app" download: for Android browsers only, never inside the app itself.
import { useEffect, useState } from 'react';
import { DOWNLOAD_URL } from '@/lib/app-download';
import { triggerHaptic } from '@/lib/haptics';
import { useT } from '@/components/I18nProvider';

const inApp = () => !!(window.Capacitor?.isNativePlatform?.() || window.Capacitor?.Plugins?.AppUpdater);

// Inside Telegram a file cannot be saved, so the link opens in the phone's browser.
function open(e) {
  triggerHaptic('light');
  const tg = window.Telegram?.WebApp;
  if (tg?.initData && tg.openLink) {
    e.preventDefault();
    tg.openLink(DOWNLOAD_URL);
  }
}

// initial: what the server could tell from the browser's name, so the home page does not jump when it loads.
export default function AppDownload({ initial = false, row = false }) {
  const t = useT();
  const [show, setShow] = useState(initial);
  useEffect(() => {
    setShow(/android/i.test(navigator.userAgent) && !inApp());
  }, []);
  if (!show) return null;
  if (row) {
    return (
      <div className="row">
        <div className="set-t">{t('app.android')}</div>
        <a className="btn ghost app-dl-s" href={DOWNLOAD_URL} onClick={open}>{t('app.download')}</a>
      </div>
    );
  }
  return (
    <a className="app-dl" href={DOWNLOAD_URL} onClick={open}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />
      </svg>
      {t('app.android')}
    </a>
  );
}
