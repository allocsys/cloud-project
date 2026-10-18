'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Field from '@/components/Field';
import { triggerHaptic } from '@/lib/haptics';
import { post, clearApiCache, signOut } from '@/lib/api';

export default function Login() {
  const router = useRouter();
  const [signup, setSignup] = useState(false);
  const [view, setView] = useState(null); // null: sign in or sign up. 'forgot': ask for a reset link. 'reset': choose a new password.
  const [rtoken, setRtoken] = useState(''); // the token from the emailed link
  const [sent, setSent] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState(false);
  const [ref, setRef] = useState('');
  const [offer, setOffer] = useState(0); // rebate % the invite code gives, shown before sign-up
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

  // What the invite code offers (its rebate), so the friend sees it before joining.
  useEffect(() => {
    if (!ref) return undefined;
    let live = true;
    fetch(`/api/referrals/code?c=${encodeURIComponent(ref)}`)
      .then((r) => r.json())
      .then((j) => live && setOffer(j.valid ? j.rebate : 0))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [ref]);

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

  // A reset link (/login?reset=TOKEN&email=...) opens the new-password screen. The token is removed from the address bar.
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      const t = (q.get('reset') || '').trim().slice(0, 100);
      const m = (q.get('email') || '').trim().slice(0, 120);
      if (!t || !m) return;
      setRtoken(t);
      setEmail(m);
      setView('reset');
      window.history.replaceState(null, '', '/login');
    } catch {}
  }, []);

  async function submit(e) {
    e.preventDefault();
    if (notice) return router.replace('/dashboard');
    const next = {};
    if (view !== 'reset' && !/^\S+@\S+\.\S+$/.test(email.trim())) next.email = 'Enter a valid email address.';
    if (view !== 'forgot' && password.length < 8) next.password = 'Password needs at least 8 characters.';
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
      if (view === 'forgot') {
        await post('/api/auth/reset', { email: email.trim() });
        triggerHaptic('success');
        setSent(true);
        setLoading(false);
        return;
      }
      const res =
        view === 'reset'
          ? await post('/api/auth/reset/confirm', { email: email.trim(), token: rtoken, password })
          : await post(signup ? '/api/auth/signup' : '/api/auth/login', { email: email.trim(), password, ...(signup && ref ? { ref } : {}) });
      clearApiCache(); // nothing from a previous account (or the demo) may show for this one
      try {
        if (signup && !view) localStorage.removeItem('opus-ref');
      } catch {}
      triggerHaptic('success');
      if (!view && signup && res?.ref === 'invalid') {
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
    if (view) {
      setView(null);
      setSent(false);
      setPassword('');
    } else setSignup(!signup);
    setErrors({});
  }

  function handleForgot() {
    triggerHaptic('selection');
    setView('forgot');
    setSent(false);
    setPassword('');
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
        {view ? (
          <>
            <h1>{view === 'forgot' ? 'Forgot your password?' : 'Choose a new password'}</h1>
            <p className="mute">{view === 'forgot' ? 'Enter your email and we will send you a reset link.' : `For ${email}. You will be signed in afterwards.`}</p>
          </>
        ) : (
          <>
            <h1>Mine bitcoin without owning a single machine.</h1>
            <p className="mute">Rent hash power, watch earnings arrive every day, withdraw whenever you like.</p>

            <div className="trust">
              <span>Daily payouts</span>
              <span>No hardware</span>
              <span>Withdraw anytime</span>
            </div>
          </>
        )}

        {view !== 'reset' && (
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
        )}

        {view !== 'forgot' && (
          <Field
            id="pw"
            label={view === 'reset' ? 'New password' : 'Password'}
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
              autoComplete={signup || view === 'reset' ? 'new-password' : 'current-password'}
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (errors.password) setErrors({ ...errors, password: undefined });
              }}
            />
          </Field>
        )}

        {errors.form && <div className="ferr" role="alert">{errors.form}</div>}

        <div style={{ height: '14px' }} />

        <button className="btn" type="submit" disabled={loading}>
          {loading
            ? view === 'forgot'
              ? 'Sending...'
              : 'Authenticating...'
            : view === 'forgot'
              ? sent
                ? 'Send again'
                : 'Send reset link'
              : view === 'reset'
                ? 'Set new password'
                : notice
                  ? 'Continue'
                  : signup
                    ? 'Create account'
                    : 'Sign in'}
        </button>

        {view === 'forgot' && sent && (
          <p className="fine" role="status">If an account exists for that email, a reset link is on its way. It works for 30 minutes.</p>
        )}
        {notice && <p className="fine" role="status">{notice}</p>}
        {!view && !notice && signup && ref && <p className="fine">Invite code {ref} will be used at sign-up.{offer > 0 ? ` It gives you a ${offer}% rebate.` : ''}</p>}
        {!view && signup && <p className="fine">By creating an account you agree to the Terms and Privacy Policy.</p>}

        {!view && !signup && (
          <button className="swap" type="button" onClick={handleForgot}>
            Forgot password?
          </button>
        )}

        <button className="swap" type="button" onClick={handleSwap}>
          {view ? 'Back to sign in' : signup ? 'Have an account? Sign in' : 'New here? Create an account'}
        </button>

        {!view && tg && (
          <button className="btn ghost" type="button" onClick={handleTelegram} disabled={tgBusy}>
            {tgBusy ? 'Connecting...' : 'Continue with Telegram'}
          </button>
        )}

        {/* Demo access. Remove this button, and set REQUIRE_AUTH=1, when the demo is no longer wanted. */}
        {!view && (
          <button className="btn ghost" type="button" onClick={handleSkip}>
            Skip login for now
          </button>
        )}
      </form>
    </section>
  );
}
