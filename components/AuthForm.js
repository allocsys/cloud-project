'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Field from '@/components/Field';
import { fill, useT } from '@/components/I18nProvider';
import { triggerHaptic } from '@/lib/haptics';
import { post, clearApiCache, signOut } from '@/lib/api';
import { MIN_WITHDRAW_USD } from '@/lib/data';

// The sign-in form that lives inside the sheet (components/AuthSheet.js): sign in, sign up, forgot and reset password,
// Telegram sign-in and the demo. `init` says how it opens: { signup } or { reset: { token, email } }.
// `onDone(path)` is called when the person is signed in (or chose the demo). `onLeave()` is called before a link
// to another page is followed, so the sheet does not undo its history entry on the way out.
export default function AuthForm({ init, onDone, onLeave }) {
  const t = useT();
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
  const [refOpen, setRefOpen] = useState(false); // the invite code field under the password, closed until asked for
  const [offer, setOffer] = useState(0); // rebate % the invite code gives, shown before sign-up
  const [tg, setTg] = useState(false); // opened inside Telegram: Telegram sign-in is offered
  const [tgBusy, setTgBusy] = useState(false);
  const [notice, setNotice] = useState(''); // set after sign-up when the invite code was not recognised; the form then waits for Continue

  // Telegram's script may load after the page does, so look a few times.
  useEffect(() => {
    let n = 0;
    const look = () => {
      if (window.Telegram?.WebApp?.initData) return setTg(true);
      if (++n < 10) tm = setTimeout(look, 300);
    };
    let tm = setTimeout(look, 0);
    return () => clearTimeout(tm);
  }, []);

  // The invite code kept from an invite link (the sheet's opener stores it), so the form can send it with sign-up.
  useEffect(() => {
    try {
      const r = (localStorage.getItem('vtx-ref') || '').trim().slice(0, 24);
      if (r) setRef(r);
    } catch {}
  }, []);

  // What the invite code offers (its rebate), so the friend sees it before joining.
  useEffect(() => {
    if (!ref) {
      setOffer(0);
      return undefined;
    }
    let live = true;
    const tm = setTimeout(() => {
      fetch(`/api/referrals/code?c=${encodeURIComponent(ref)}`)
        .then((r) => r.json())
        .then((j) => live && setOffer(j.valid ? j.rebate : 0))
        .catch(() => {});
    }, 350);
    return () => {
      live = false;
      clearTimeout(tm);
    };
  }, [ref]);

  async function submit(e) {
    e.preventDefault();
    if (notice) return onDone('/plans');
    const next = {};
    if (view !== 'reset' && !/^\S+@\S+\.\S+$/.test(email.trim())) next.email = t('auth.errEmail');
    if (view !== 'forgot' && password.length < 8) next.password = t('auth.errPassword');
    if (next.email || next.password) {
      triggerHaptic('error');
      setErrors(next);
      const el = document.getElementById(next.email ? 'em' : 'pw');
      if (el) el.focus();
      return;
    }

    if (needCode && view !== 'forgot' && !signup && !code.trim()) {
      triggerHaptic('error');
      setErrors({ code: t('auth.errCode') });
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
        setNotice(t('auth.createdInvalid', { code: ref }));
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
        setNotice(t('auth.createdInvalid', { code: ref }));
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

  const title = view === 'forgot' ? t('auth.forgotTitle') : view === 'reset' ? t('auth.resetTitle') : signup ? t('auth.signupTitle') : t('auth.signIn');
  const sub =
    view === 'forgot'
      ? t('auth.forgotSub')
      : view === 'reset'
        ? t('auth.resetSub', { email })
        : signup
          ? t('auth.signupSub', { n: MIN_WITHDRAW_USD })
          : t('auth.welcomeBack');

  return (
    <form className="authform" onSubmit={submit} noValidate>
      <h3 id="auth-t">{title}</h3>
      <p className="mute">{sub}</p>

      {view !== 'reset' && (
        <Field id="em" label={t('auth.email')} error={errors.email}>
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
          label={view === 'reset' ? t('auth.newPassword') : t('auth.password')}
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
              {show ? t('auth.hide') : t('auth.show')}
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
            placeholder={t('auth.pwPlaceholder')}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (errors.password) setErrors({ ...errors, password: undefined });
            }}
          />
        </Field>
      )}

      {needCode && view !== 'forgot' && !signup && (
        <Field id="tc" label={t('auth.codeLabel')} error={errors.code}>
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
            placeholder={t('auth.codePlaceholder')}
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              if (errors.code) setErrors({ ...errors, code: undefined });
            }}
          />
        </Field>
      )}

      {!view && signup && (
        <>
          <button
            type="button"
            className="swap"
            aria-expanded={refOpen}
            aria-controls="rc"
            onClick={() => {
              triggerHaptic('selection');
              setRefOpen(!refOpen);
            }}
          >
            {t('auth.refToggle')}
          </button>
          {refOpen && (
            <Field id="rc" label={t('auth.refLabel')}>
              <input
                id="rc"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck="false"
                maxLength={24}
                value={ref}
                onChange={(e) => setRef(e.target.value.trim().slice(0, 24))}
              />
            </Field>
          )}
          {refOpen && ref && offer > 0 && <p className="fine">{t('auth.rebate', { n: offer })}</p>}
        </>
      )}

      {errors.form && <div className="ferr" role="alert">{errors.form}</div>}

      <div style={{ height: '14px' }} />

      <button className="btn" type="submit" disabled={loading}>
        {loading
          ? view === 'forgot'
            ? t('auth.sending')
            : t('auth.authenticating')
          : view === 'forgot'
            ? sent
              ? t('auth.sendAgain')
              : t('auth.sendLink')
            : view === 'reset'
              ? t('auth.setNew')
              : notice
                ? t('common.continue')
                : signup
                  ? t('auth.createAccount')
                  : t('auth.signIn')}
      </button>

      {/* Demo access. Remove this button, and set REQUIRE_AUTH=1, when the demo is no longer wanted. */}
      {!view && (
        <button className="btn ghost" type="button" style={{ marginTop: '12px' }} onClick={handleSkip}>
          {t('auth.demo')}
        </button>
      )}

      {view === 'forgot' && sent && (
        <p className="fine" role="status">{t('auth.resetSent')}</p>
      )}
      {notice && <p className="fine" role="status">{notice}</p>}
      {!view && !notice && signup && ref && !refOpen && <p className="fine">{t('auth.inviteUsed', { code: ref })}{offer > 0 ? ` ${t('auth.rebate', { n: offer })}` : ''}</p>}
      {!view && signup && (
        <p className="fine" style={{ margin: '14px 0 4px', textAlign: 'center' }}>
          {fill(t('auth.agree'), {
            terms: (
              <Link href="/terms" onClick={onLeave} style={{ color: 'var(--gold2)' }}>{t('auth.terms')}</Link>
            ),
            privacy: (
              <Link href="/privacy" onClick={onLeave} style={{ color: 'var(--gold2)' }}>{t('auth.privacy')}</Link>
            ),
          })}
        </p>
      )}

      {!view && !signup && (
        <button className="swap" type="button" onClick={handleForgot}>
          {t('auth.forgot')}
        </button>
      )}

      <button className="swap" type="button" onClick={handleSwap}>
        {view ? t('auth.swapBack') : signup ? t('auth.swapSignin') : t('auth.swapSignup')}
      </button>

      {!view && tg && (
        <button className="btn ghost" type="button" onClick={handleTelegram} disabled={tgBusy}>
          {tgBusy ? t('auth.connecting') : t('auth.telegram')}
        </button>
      )}
    </form>
  );
}
