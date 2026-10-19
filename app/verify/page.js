'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { triggerHaptic } from '@/lib/haptics';
import { post, clearApiCache } from '@/lib/api';

// Opened from the link in the verification email: /verify?token=...&email=...
export default function Verify() {
  const router = useRouter();
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
      setMsg('This link is incomplete. Open the link from your email again.');
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
        setMsg(err.status ? err.message : 'No connection. Try the link again.');
      });
  }, []);

  return (
    <section id="auth">
      <div className="authbox">
        <div className="mark">O</div>
        {state === 'checking' && (
          <>
            <h1>Confirming your email</h1>
            <p className="mute">One moment.</p>
          </>
        )}
        {state === 'ok' && (
          <>
            <h1>Email confirmed</h1>
            <p className="mute">Thanks. Your email address is now verified.</p>
          </>
        )}
        {state === 'bad' && (
          <>
            <h1>Link not valid</h1>
            <p className="mute">{msg}</p>
            <p className="fine">You can ask for a new link in Settings after you sign in.</p>
          </>
        )}
        <div style={{ height: '14px' }} />
        {state !== 'checking' && (
          <button className="btn" type="button" onClick={() => router.replace('/dashboard')}>
            Continue
          </button>
        )}
      </div>
    </section>
  );
}
