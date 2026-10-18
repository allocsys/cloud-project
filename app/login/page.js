'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { triggerHaptic } from '@/lib/haptics';

export default function Login() {
  const router = useRouter();
  const [signup, setSignup] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState(false);

  // TODO: call your auth API here.
  function submit(e) {
    e.preventDefault();
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

    triggerHaptic('success');
    setErrors({});
    setLoading(true);
    setTimeout(() => {
      router.replace('/dashboard');
    }, 150);
  }

  function handleSwap() {
    triggerHaptic('selection');
    setSignup(!signup);
    setErrors({});
  }

  function handleSkip() {
    triggerHaptic('light');
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

        <label htmlFor="em">Email</label>
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
        {errors.email && <div className="ferr" id="em-err" role="alert">{errors.email}</div>}

        <label htmlFor="pw">Password</label>
        <div className="pwrap">
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
        </div>
        {errors.password && <div className="ferr" id="pw-err" role="alert">{errors.password}</div>}

        <div style={{ height: '14px' }} />

        <button className="btn" type="submit" disabled={loading}>
          {loading ? 'Authenticating...' : signup ? 'Create account' : 'Sign in'}
        </button>

        {signup && <p className="fine">By creating an account you agree to the Terms and Privacy Policy.</p>}

        <button className="swap" type="button" onClick={handleSwap}>
          {signup ? 'Have an account? Sign in' : 'New here? Create an account'}
        </button>

        {/* TODO: remove once real auth is wired */}
        <button className="btn ghost" type="button" onClick={handleSkip}>
          Skip login for now
        </button>
      </form>
    </section>
  );
}
