'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/components/I18nProvider';
import { triggerHaptic } from '@/lib/haptics';
import { post, clearApiCache } from '@/lib/api';
import MarkIcon from '@/components/MarkIcon';

// Opened from the link in the verification email: /verify?token=...&email=...
export default function Verify() {
  const router = useRouter();
  const t = useT();
  const ran = useRef(false);
  const [state, setState] = useState('checking'); // checking | ok | bad
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    let token = '';
    let email = '';
    try {
      const q = new URLSearchParams(window.location.search);
      token = (q.get('token') || '').trim().slice(0, 100);
      email = (q.get('email') || '').trim().slice(0, 120);
      window.history.replaceState(null, '', '/verify'); // the token does not stay in the address bar
    } catch {}
    if (!token || !email) {
      setState('bad');
      setMsg(t('verify.incomplete'));
      return;
    }
    post('/api/auth/verify', { email, token })
      .then(() => {
        clearApiCache(); // Settings must show the new status
        triggerHaptic('success');
        setState('ok');
      })
      .catch((err) => {
        triggerHaptic('error');
        setState('bad');
        setMsg(err.status ? err.message : t('verify.noConnection'));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section id="auth">
      <div className="authbox">
        <div className="mark"><MarkIcon /></div>
        {state === 'checking' && (
          <>
            <h1>{t('verify.checking')}</h1>
            <p className="mute">{t('verify.moment')}</p>
          </>
        )}
        {state === 'ok' && (
          <>
            <h1>{t('verify.ok')}</h1>
            <p className="mute">{t('verify.okSub')}</p>
          </>
        )}
        {state === 'bad' && (
          <>
            <h1>{t('verify.bad')}</h1>
            <p className="mute">{msg}</p>
            <p className="fine">{t('verify.askNew')}</p>
          </>
        )}
        <div style={{ height: '14px' }} />
        {state !== 'checking' && (
          <button className="btn" type="button" onClick={() => router.replace('/dashboard')}>
            {t('common.continue')}
          </button>
        )}
      </div>
    </section>
  );
}
