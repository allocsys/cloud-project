'use client';
// Inside the Android app only (the app adds the PushNotifications plugin when the build has Firebase; a browser or an older app has none,
// so nothing happens). Asks once for the Android notification permission, then tells the server this phone's token (POST /api/push,
// lib/server/push.js): again only when the token or the language changed, or a day passed. Tapping a notice opens its page.
// signOut() (components/api.js) forgets the phone, so the next account on it does not get the last one's notices.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLang } from '@/components/I18nProvider';

export const PUSH_KEY = 'vtx-push';
const DAY = 24 * 3600 * 1000;

// Setup steps go to the server log as '[push] step: ...' (a few per app start), so a silent failure shows where it stopped.
let sent = 0;
const step = (msg) => {
  if (sent >= 10) return;
  sent += 1;
  try {
    fetch('/api/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ step: String(msg).slice(0, 300) }),
    }).catch(() => {});
  } catch {}
};

const plugin = () => {
  try {
    const c = window.Capacitor;
    if (!c) {
      // Only inside the Android app's WebView, not for every web visitor.
      if (/; wv\)/.test(navigator.userAgent || '')) step('no Capacitor');
      return null;
    }
    if (!c.isNativePlatform?.()) return null;
    const avail = c.isPluginAvailable?.('PushNotifications');
    const p = c.Plugins?.PushNotifications || null;
    if (!avail || !p) {
      step('plugin missing; available=' + avail + ' plugins=' + Object.keys(c.Plugins || {}).join(','));
      return null;
    }
    return p;
  } catch (e) {
    step('plugin check failed: ' + (e?.message || e));
    return null;
  }
};

// A phone that cannot register tells the server why (once per app start), so it shows in the server log as '[push] phone could not register'.
let told = false;
const report = (e) => {
  if (told) return;
  told = true;
  try {
    const msg = typeof e === 'string' ? e : e?.error || e?.message || JSON.stringify(e);
    fetch('/api/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: String(msg).slice(0, 300) }),
    }).catch(() => {});
  } catch {}
};

const saved = () => {
  try {
    return JSON.parse(localStorage.getItem(PUSH_KEY) || 'null');
  } catch {
    return null;
  }
};

export default function PushSetup() {
  const { lang } = useLang();
  const router = useRouter();

  useEffect(() => {
    const p = plugin();
    if (!p) return undefined;
    step('plugin found');
    let gone = false;
    const subs = [];
    const on = async (name, fn) => {
      try {
        const h = await p.addListener(name, fn);
        if (gone) h?.remove?.();
        else subs.push(h);
      } catch (e) {
        step('listener ' + name + ' failed: ' + (e?.message || e));
      }
    };

    (async () => {
      await on('registration', async ({ value }) => {
        step('token received');
        const s = saved();
        if (s && s.t === value && s.lang === lang && Date.now() - s.at < DAY) return;
        try {
          const r = await fetch('/api/push', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token: value, lang }),
          });
          if (r.ok) localStorage.setItem(PUSH_KEY, JSON.stringify({ t: value, lang, at: Date.now() }));
          else step('token save failed: ' + r.status);
        } catch (e) {
          step('token save failed: ' + (e?.message || e));
        }
      });
      await on('registrationError', (e) => report(e));
      await on('pushNotificationActionPerformed', ({ notification }) => {
        const url = notification?.data?.url;
        if (typeof url === 'string' && url.startsWith('/') && !url.startsWith('//')) router.push(url);
      });
      if (gone) return;
      try {
        let st = (await p.checkPermissions())?.receive;
        step('permission ' + st);
        if (st === 'prompt' || st === 'prompt-with-rationale') {
          st = (await p.requestPermissions())?.receive;
          step('permission after ask ' + st);
        }
        if (st === 'granted' && !gone) {
          await p.register();
          step('register called');
        } else if (st !== 'granted') report('permission ' + st);
      } catch (e) {
        report(e);
      }
    })();

    return () => {
      gone = true;
      subs.forEach((h) => h?.remove?.());
    };
  }, [lang, router]);

  return null;
}
