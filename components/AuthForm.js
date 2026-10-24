'use client';
// The sign-in form that lives inside the sheet (components/AuthSheet.js): sign in, sign up, forgot and reset password,
// Telegram sign-in and the demo. `init` says how it opens: { signup } or { reset: { token, email } }.
// `onDone(path)` is called when the person is signed in (or chose the demo). `onLeave()` is called before a link
// to another page is followed, so the sheet does not undo its history entry on the way out.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Field from '@/components/Field';
import { triggerHaptic } from '@/lib/haptics';
import { post, clearApiCache, signOut } from '@/lib/api';
import { MIN_WITHDRAW_USD } from '@/lib/data';

export default function AuthForm({ init, onDone, onLeave }) {
  const [signup, setSignup] = useState(!!init?.signup);
  const [view, setView] = useState(init?.reset ? 'reset' : null); // null: sign in or sign up. 'forgot': ask for a reset link. 'reset': choose a new password.
  const [rtoken] = useState(init?.reset?.token || ''); // the token from the emailed link
  const [sent, setSent] = useState(false);
  const [email, setEmail] = useState(init?.reset?.email || '');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState(false);
  const [needCode, setNeedCode] = useState(false); // the account has two-factor on: ask for the code
  const [code, setCode] = useState('');
  const [ref, setRef] = useState('');
  const [offer, setOffer] = useState(0); // rebate % the invite code gives, shown before sign-up
  const [tg, setTg] = useState(false); // opened inside Telegram: Telegram sign-in is offered
  const [tgBusy, setTgBusy] = useState(false);
  const [notice, setNotice] = useState(''); // set after sign-up when the invite code was not recognised; the form then waits for Continue

  // Telegram's script may load after the page does, so look a few times.
  useEffect(() => {
    let n = 0;
    const look = () => {
      if (window.Telegram?.WebApp?.initData) return setTg(true);
      if (++n < 10) t = setTimeout(look, 300);
    };
    let t = setTimeout(look, 0);
    return () => clearTimeout(t);
  }, []);

  // The invite code kept from an invite link (the sheet's opener stores it), so the form can send it with sign-up.
  useEffect(() => {
    try {
      const r = (localStorage.getItem('opus-ref') || '').trim().slice(0, 24);
      if (r) setRef(r);
    } catch {}
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

  async function submit(e) {
    e.preventDefault();
    if (notice) return onDone('/plans');
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

    if (needCode && view !== 'forgot' && !signup && !code.trim()) {
      triggerHaptic('error');
      setErrors({ code: 'Enter the 6-digit code from your authenticator app.' });
      const el = document.getElementById('tc');
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
          ? await post('/api/auth/reset/confirm', { email: email.trim(), token: rtoken, password, ...(needCode ? { code: code.trim() } : {}) })
          : await post(signup ? '/api/auth/signup' : '/api/auth/login', { email: email.trim(), password, ...(signup && ref ? { ref } : {}), ...(!signup && needCode ? { code: code.trim() } : {}) });
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
      onDone('/plans');
    } catch (err) {
      triggerHaptic('error');
      setLoading(false);
      if (err.field === 'code') {
        // The password was right and the account asks for a second step (or the code was wrong).
        setNeedCode(true);
        setErrors({ code: err.message });
        setTimeout(() => document.getElementById('tc')?.focus(), 0);
        return;
      }
      setErrors(err.field === 'email' || err.field === 'password' ? { [err.field]: err.message } : { form: err.message });
    }
  }

  function handleSwap() {
    triggerHaptic('selection');
    setNeedCode(false);
    setCode('');
    if (view) {
      setView(null);
      setSent(false);
      setPassword('');
    } else setSignup(!signup);
    setErrors({});
  }

  function handleForgot() {
    triggerHaptic('selection');
    setNeedCode(false);
    setCode('');
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
      onDone('/plans');
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
    onDone('/plans');
  }

  const title = view === 'forgot' ? 'Forgot your password?' : view === 'reset' ? 'Choose a new password' : signup ? 'Create your account' : 'Sign in';
  const sub =
    view === 'forgot'
      ? 'Enter your email and we will send you a reset link.'
      : view === 'reset'
        ? `For ${email}. You will be signed in afterwards.`
        : signup
          ? `Rent hash power, watch earnings arrive every day, and withdraw from just $${MIN_WITHDRAW_USD}.`
          : 'Welcome back.';

  return (
    <form className="authform" onSubmit={submit} noValidate>
      <h3 id="auth-t">{title}</h3>
      <p className="mute">{sub}</p>

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

      {needCode && view !== 'forgot' && !signup && (
        <Field id="tc" label="Authentication code" error={errors.code}>
          <input
            id="tc"
            className={errors.code ? 'bad' : undefined}
            aria-invalid={!!errors.code}
            aria-describedby={errors.code ? 'tc-err' : undefined}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck="false"
            placeholder="6-digit code, or a recovery code"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              if (errors.code) setErrors({ ...errors, code: undefined });
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

      {/* Demo access. Remove this button, and set REQUIRE_AUTH=1, when the demo is no longer wanted. */}
      {!view && (
        <button className="btn ghost" type="button" style={{ marginTop: '12px' }} onClick={handleSkip}>
          Explore the demo first
        </button>
      )}

      {view === 'forgot' && sent && (
        <p className="fine" role="status">If an account exists for that email, a reset link is on its way. It works for 30 minutes.</p>
      )}
      {notice && <p className="fine" role="status">{notice}</p>}
      {!view && !notice && signup && ref && <p className="fine">Invite code {ref} will be used at sign-up.{offer > 0 ? ` It gives you a ${offer}% rebate.` : ''}</p>}
      {!view && signup && (
        <p className="fine" style={{ margin: '14px 0 4px', textAlign: 'center' }}>
          By creating an account you agree to the{' '}
          <Link href="/terms" onClick={onLeave} style={{ color: 'var(--gold2)' }}>Terms</Link> and{' '}
          <Link href="/privacy" onClick={onLeave} style={{ color: 'var(--gold2)' }}>Privacy Policy</Link>.
        </p>
      )}

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
    </form>
  );
}
