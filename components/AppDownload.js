'use client';
// App download: for the landing menu (menu) and the Settings list (row). Direct download is for Android browsers only, never inside the app itself.
// When the Google Play / App Store links are set in lib/app-download.js, the menu item opens a short list instead of downloading at once.
import { useEffect, useState } from 'react';
import { DOWNLOAD_URL, GOOGLE_PLAY_URL, APP_STORE_URL } from '@/lib/app-download';
import { triggerHaptic } from '@/components/haptics';
import { useT } from '@/components/I18nProvider';

const inApp = () => !!(window.Capacitor?.isNativePlatform?.() || window.Capacitor?.Plugins?.AppUpdater);

// Inside Telegram a file cannot be saved, so the link opens in the phone's browser.
function open(e, url) {
  triggerHaptic('light');
  const tg = window.Telegram?.WebApp;
  if (tg?.initData && tg.openLink) {
    e.preventDefault();
    tg.openLink(url);
  }
}

function options() {
  if (inApp()) return [];
  const ua = navigator.userAgent;
  const android = /android/i.test(ua);
  const ios = /iphone|ipad|ipod/i.test(ua);
  const out = [];
  if (android) out.push({ k: 'apk', url: DOWNLOAD_URL });
  if (android && GOOGLE_PLAY_URL) out.push({ k: 'play', url: GOOGLE_PLAY_URL });
  if (ios && APP_STORE_URL) out.push({ k: 'ios', url: APP_STORE_URL });
  return out;
}

// initial: what the server could tell from the browser's name, so the menu item does not jump when it loads.
export default function AppDownload({ initial = false, row = false, menu = false }) {
  const t = useT();
  const [opts, setOpts] = useState(initial ? [{ k: 'apk', url: DOWNLOAD_URL }] : []);
  const [more, setMore] = useState(false);
  useEffect(() => {
    setOpts(options());
  }, []);
  if (!opts.length) return null;
  const label = { apk: t('app.android'), play: 'Google Play', ios: 'App Store' };
  if (row) {
    const apk = opts.find((o) => o.k === 'apk');
    if (!apk) return null;
    return (
      <div className="row">
        <span className="set-t">{t('app.android')}</span>
        <a className="btn ghost app-dl-s" href={apk.url} onClick={(e) => open(e, apk.url)}>{t('app.download')}</a>
      </div>
    );
  }
  if (!menu) return null;
  if (opts.length === 1) {
    return (
      <a href={opts[0].url} onClick={(e) => open(e, opts[0].url)}>
        {t('app.get')}
      </a>
    );
  }
  return (
    <>
      <button type="button" aria-expanded={more} onClick={() => setMore(!more)}>
        {t('app.get')}
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
          <path d={more ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} />
        </svg>
      </button>
      {more && opts.map((o) => (
        <a key={o.k} className="lm-sub" href={o.url} onClick={(e) => open(e, o.url)}>
          {label[o.k]}
        </a>
      ))}
    </>
  );
}
