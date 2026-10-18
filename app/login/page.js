'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Field from '@/components/Field';
import { triggerHaptic } from '@/lib/haptics';
import { post, clearApiCache, signOut } from '@/lib/api';

export default function Login() {
  const router = useRouter();
  const [signup, setSignup] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState(false);
  const [ref, setRef] = useState('');
  const [tg, setTg] = useState(false); // opened inside Telegram: Telegram sign-in is offered
  const [tgBusy, setTgBusy] = useState(false);
  const [notice, setNotice] = useState(''); // set after sign-up when the invite code was not recognised; the page then waits for Continue

  // Telegram's script may load after this page does, so look a few times.
  useEffect(() => {
    let n = 0;
    const look = () => {
      if (window.Telegram?.WebApp?.initData) return setTg(true);
      if (++n < 10) t = setTimeout(look, 300);
    };
    let t = setTimeout(look, 0);
    return () => clearTimeout(t);
  }, []);

  // An invite link (/login?ref=CODE) opens sign-up and keeps the code, which is sent with the sign-up request.
  useEffect(() => {
    try {
      const r = (new URLSearchParams(window.location.search).get('ref') || localStorage.getItem('opus-ref') || '').trim().slice(0, 24);
      if (!r) return;
      localStorage.setItem('opus-ref', r);
      setRef(r);
      if (new URLSearchParams(window.location.search).get('ref')) setSignup(true);
    } catch {}
  }, []);

  async function submit(e) {
    e.preventDefault();
    if (notice) return router.replace('/dashboard');
    const next = {};
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) next.email = 'Enter a valid email address.';
    if (password.length < 8) next.password = 'Password needs at least 8 characters.';
    if (next.email || next.password) {
      triggerHaptic('error');
      setErrors(next);
      const el = document.getElementById(next.email ? 'em' : 'pw');
      if (el) el.focus();
      return;
    }

    setErrors({});
    setLoading(true);
    try {
      const res = await post(signup ? '/api/auth/signup' : '/api/auth/login', { email: email.trim(), password, ...(signup && ref ? { ref } : {}) });
      clearApiCache(); // nothing from a previous account (or the demo) may show for this one
      try {
        if (signup) localStorage.removeItem('opus-ref');
      } catch {}
      triggerHaptic('success');
      if (signup && res?.ref === 'invalid') {
        setNotice(`Account created. Invite code ${ref} was not recognised.`);
        setLoading(false);
        return;
      }
      router.replace('/dashboard');
    } catch (err) {
      triggerHaptic('error');
      setLoading(false);
      setErrors(err.field === 'email' || err.field === 'password' ? { [err.field]: err.message } : { form: err.message });
    }
  }

  function handleSwap() {
    triggerHaptic('selection');
    setSignup(!signup);
    setErrors({});
  }

  async function handleTelegram() {
    triggerHaptic('light');
    setErrors({});
    setTgBusy(true);
    try {
      const res = await post('/api/auth/telegram', { initData: window.Telegram?.WebApp?.initData || '', ...(ref ? { ref } : {}) });
      clearApiCache();
      try {
        localStorage.removeItem('opus-ref');
      } catch {}
      triggerHaptic('success');
      if (res?.ref === 'invalid') {
        setNotice(`Account created. Invite code ${ref} was not recognised.`);
        setTgBusy(false);
        return;
      }
      router.replace('/dashboard');
    } catch (err) {
      triggerHaptic('error');
      setTgBusy(false);
      setErrors({ form: err.message });
    }
  }

  // Demo access: drop any real session first so the demo never opens inside someone's account.
  async function handleSkip() {
    triggerHaptic('light');
    await signOut();
    router.replace('/dashboard');
  }

  return (
    <section id="auth">
      <form className="authbox" onSubmit={submit} noValidate>
        <div className="mark">O</div>
        <h1>Mine bitcoin without owning a single machine.</h1>
        <p className="mute">Rent hash power, watch earnings arrive every day, withdraw whenever you like.</p>

        <div className="trust">
          <span>Daily payouts</span>
          <span>No hardware</span>
          <span>Withdraw anytime</span>
        </div>

        <Field id="em" label="Email" error={errors.email}>
          <input
            id="em"
            type="email"
            className={errors.email ? 'bad' : undefined}
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? 'em-err' : undefined}
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck="false"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (errors.email) setErrors({ ...errors, email: undefined });
            }}
          />
        </Field>

        <Field
          id="pw"
          label="Password"
          error={errors.password}
          className="pw"
          side={
            <button
              type="button"
              className="pwtoggle"
              aria-pressed={show}
              onClick={() => {
                triggerHaptic('selection');
                setShow(!show);
              }}
            >
              {show ? 'Hide' : 'Show'}
            </button>
          }
        >
          <input
            id="pw"
            type={show ? 'text' : 'password'}
            className={errors.password ? 'bad' : undefined}
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? 'pw-err' : undefined}
            autoComplete={signup ? 'new-password' : 'current-password'}
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (errors.password) setErrors({ ...errors, password: undefined });
            }}
          />
        </Field>

        {errors.form && <div className="ferr" role="alert">{errors.form}</div>}

        <div style={{ height: '14px' }} />

        <button className="btn" type="submit" disabled={loading}>
          {loading ? 'Authenticating...' : notice ? 'Continue' : signup ? 'Create account' : 'Sign in'}
        </button>

        {notice && <p className="fine" role="status">{notice}</p>}
        {!notice && signup && ref && <p className="fine">Invite code {ref} will be used at sign-up.</p>}
        {signup && <p className="fine">By creating an account you agree to the Terms and Privacy Policy.</p>}

        <button className="swap" type="button" onClick={handleSwap}>
          {signup ? 'Have an account? Sign in' : 'New here? Create an account'}
        </button>

        {tg && (
          <button className="btn ghost" type="button" onClick={handleTelegram} disabled={tgBusy}>
            {tgBusy ? 'Connecting...' : 'Continue with Telegram'}
          </button>
        )}

        {/* Demo access. Remove this button, and set REQUIRE_AUTH=1, when the demo is no longer wanted. */}
        <button className="btn ghost" type="button" onClick={handleSkip}>
          Skip login for now
        </button>
      </form>
    </section>
  );
}
