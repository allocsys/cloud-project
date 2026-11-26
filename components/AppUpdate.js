'use client';
// Inside the Android app only (the app adds the AppUpdater plugin; a browser or an old app version has none, so nothing shows).
// The site says if a newer version exists (/api/app-update, remembered 3 hours), the plugin downloads it (a stopped download
// goes on from where it stopped; when a small patch fits, only the patch is downloaded) and opens the Android installer.
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useT } from '@/components/I18nProvider';

const KEY = 'vtx-upd';
const HIDE = 'vtx-upd-hide';
const EVERY = 3 * 3600 * 1000;

const plugin = () => {
  try {
    const c = window.Capacitor;
    return (c && c.Plugins && c.Plugins.AppUpdater) || null;
  } catch {
    return null;
  }
};

// The About page shows the bar itself (always: also after it was closed), so the app-wide one steps aside there.
export default function AppUpdate({ always = false }) {
  const path = usePathname();
  if (!always && path === '/settings/about') return null;
  return <UpdateBar always={always} />;
}

function UpdateBar({ always }) {
  const t = useT();
  const [info, setInfo] = useState(null);
  const [st, setSt] = useState('new'); // new, busy, ready, allow, fail
  const [pct, setPct] = useState(0);
  const [hidden, setHidden] = useState(false);
  const timer = useRef(0);

  const stop = () => {
    clearInterval(timer.current);
    timer.current = 0;
  };

  const install = useCallback(async (code) => {
    const p = plugin();
    if (!p) return;
    try {
      const r = await p.install({ code });
      setSt(r && r.needsPermission ? 'allow' : 'ready');
    } catch {
      setSt('fail');
    }
  }, []);

  const watch = useCallback(
    (code) => {
      stop();
      timer.current = setInterval(async () => {
        const p = plugin();
        if (!p) return stop();
        try {
          const s = await p.status({ code });
          if (s.state === 'busy') setPct(s.total ? Math.min(99, Math.floor((100 * s.done) / s.total)) : 0);
          else if (s.state === 'ready') {
            stop();
            setPct(100);
            setSt('ready');
            install(code);
          } else {
            stop();
            setSt('fail');
          }
        } catch {
          stop();
          setSt('fail');
        }
      }, 700);
    },
    [install]
  );

  const start = async (a) => {
    const p = plugin();
    if (!p || !a) return;
    setSt('busy');
    setPct(0);
    try {
      await p.download({
        code: a.code,
        apkUrl: a.apk.url,
        apkSize: a.apk.size,
        apkSha: a.apk.sha256,
        ...(a.patch ? { patchUrl: a.patch.url, patchSize: a.patch.size, patchSha: a.patch.sha256, patchBase: a.patch.base } : {}),
      });
      watch(a.code);
    } catch {
      setSt('fail');
    }
  };

  useEffect(() => {
    let dead = false;
    const check = async () => {
      const p = plugin();
      if (!p) return;
      try {
        if (!always && sessionStorage.getItem(HIDE)) return;
      } catch {}
      let have;
      try {
        have = (await p.info()).code;
      } catch {
        return;
      }
      let ans = null;
      try {
        const c = JSON.parse(localStorage.getItem(KEY) || 'null');
        if (c && c.have === have && Date.now() - c.at < EVERY) ans = c.ans;
      } catch {}
      if (!ans) {
        try {
          const r = await fetch(`/api/app-update?code=${have}`, { cache: 'no-store' });
          if (!r.ok) return;
          ans = await r.json();
          try {
            localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), have, ans }));
          } catch {}
        } catch {
          return;
        }
      }
      if (dead || !ans || !ans.update) return;
      setInfo(ans);
      try {
        // A download may already run or be finished (the page was reloaded meanwhile).
        const s = await p.status({ code: ans.code });
        if (s.state === 'busy') {
          setSt('busy');
          watch(ans.code);
        } else if (s.state === 'ready') setSt('ready');
      } catch {}
    };
    check();
    const onShow = () => {
      if (!document.hidden) check();
    };
    document.addEventListener('visibilitychange', onShow);
    return () => {
      dead = true;
      stop();
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [watch, always]);

  if (!info || hidden) return null;
  const busy = st === 'busy';
  const label = busy ? t('appupd.downloading', { p: pct }) : st === 'fail' ? t('appupd.failed') : st === 'allow' ? t('appupd.allow') : t('appupd.title');
  const act = st === 'ready' || st === 'allow' ? () => install(info.code) : () => start(info);
  const btn = st === 'ready' || st === 'allow' ? t('appupd.install') : st === 'fail' ? t('appupd.retry') : t('appupd.update');
  return (
    <div role="status" style={{ margin: '0 0 12px', padding: '10px 12px', border: '1px solid var(--gold)', borderRadius: 12, fontSize: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ flex: 1, minWidth: 0 }}>{label}</span>
        {!busy && (
          <button type="button" className="btn" style={{ width: 'auto', minHeight: 36, padding: '0 16px' }} onClick={act}>
            {btn}
          </button>
        )}
        {!busy && !always && (
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={() => {
              try {
                sessionStorage.setItem(HIDE, '1');
              } catch {}
              setHidden(true);
            }}
            style={{ flex: 'none', width: 32, height: 32, border: 0, borderRadius: 16, background: 'transparent', color: 'var(--mute)', fontSize: 18, cursor: 'pointer' }}
          >
            ×
          </button>
        )}
      </div>
      {busy && (
        <div className="bar">
          <i style={{ width: `${pct}%`, animation: 'none' }} />
        </div>
      )}
    </div>
  );
}
