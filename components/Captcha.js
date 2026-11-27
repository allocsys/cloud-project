'use client';
// The bot check box (Cloudflare Turnstile) for the sign-in form. It asks /api/captcha for the site key: with no key it shows nothing and
// reports itself off, so the form works as before. onActive(true) tells the form to wait for a token; onToken('') clears it again.
// To get a fresh check after each attempt the form mounts it again with a new `key`.
import { useEffect, useRef } from 'react';

let keyP;
const siteKey = () => (keyP ||= fetch('/api/captcha').then((r) => r.json()).then((j) => j?.key || null).catch(() => null));

let scriptP;
const loadScript = () =>
  (scriptP ||= new Promise((res, rej) => {
    if (window.turnstile) return res();
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => res();
    s.onerror = () => {
      scriptP = null;
      rej(new Error('script'));
    };
    document.head.appendChild(s);
  }));

export default function Captcha({ onActive, onToken }) {
  const box = useRef(null);

  useEffect(() => {
    let live = true;
    let id = null;
    (async () => {
      const key = await siteKey();
      if (!live || !key) return;
      onActive(true);
      try {
        await loadScript();
      } catch {
        return;
      }
      if (!live || !box.current || !window.turnstile) return;
      id = window.turnstile.render(box.current, {
        sitekey: key,
        theme: 'dark',
        callback: (t) => onToken(t),
        'expired-callback': () => onToken(''),
        'error-callback': () => onToken(''),
      });
    })();
    return () => {
      live = false;
      onActive(false);
      onToken('');
      try {
        if (id !== null) window.turnstile?.remove(id);
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={box} style={{ marginTop: '12px', minHeight: 0, display: 'flex', justifyContent: 'center' }} />;
}
