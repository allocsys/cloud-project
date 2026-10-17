'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { triggerHaptic } from '@/lib/haptics';

export default function Login() {
  const router = useRouter();
  const [signup, setSignup] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // TODO: call your auth API here.
  function submit(e) {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      triggerHaptic('error');
      return setError('Enter a valid email address.');
    }
    if (password.length < 8) {
      triggerHaptic('error');
      return setError('Password needs at least 8 characters.');
    }

    triggerHaptic('success');
    setLoading(true);
    setTimeout(() => {
      router.push('/dashboard');
    }, 150);
  }

  function handleSwap() {
    triggerHaptic('selection');
    setSignup(!signup);
    setError('');
  }

  function handleSkip() {
    triggerHaptic('light');
    router.push('/dashboard');
  }

  return (
    <section id="auth">
      <form className="authbox" onSubmit={submit} noValidate>
        <div className="mark">O</div>
        <h1>Mine bitcoin without owning a single machine.</h1>
        <p className="mute">Rent hash power, watch earnings arrive every day, withdraw whenever you like.</p>
        
        <label htmlFor="em">Email</label>
        <input
          id="em"
          type="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck="false"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        
        <label htmlFor="pw">Password</label>
        <input
          id="pw"
          type="password"
          autoComplete={signup ? 'new-password' : 'current-password'}
          placeholder="At least 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        
        <div className="err" role="alert">
          {error && (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{error}</span>
            </>
          )}
        </div>
        
        <button className="btn" type="submit" disabled={loading}>
          {loading ? 'Authenticating...' : signup ? 'Create account' : 'Sign in'}
        </button>
        
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
