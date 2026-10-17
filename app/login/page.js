'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Login() {
  const router = useRouter();
  const [signup, setSignup] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  // TODO: call your auth API here.
  function submit(e) {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Enter a valid email address.');
    if (password.length < 8) return setError('Password needs at least 8 characters.');
    router.push('/dashboard');
  }

  return (
    <section id="auth">
      <form className="authbox" onSubmit={submit} noValidate>
        <div className="mark">O</div>
        <h1>Mine bitcoin without owning a single machine.</h1>
        <p className="mute">Rent hash power, watch earnings arrive every day, withdraw whenever you like.</p>
        <label htmlFor="em">Email</label>
        <input id="em" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <label htmlFor="pw">Password</label>
        <input id="pw" type="password" autoComplete={signup ? 'new-password' : 'current-password'} placeholder="At least 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="err" role="alert">{error}</div>
        <button className="btn" type="submit">{signup ? 'Create account' : 'Sign in'}</button>
        <button className="swap" type="button" onClick={() => { setSignup(!signup); setError(''); }}>
          {signup ? 'Have an account? Sign in' : 'New here? Create an account'}
        </button>
        {/* TODO: remove once real auth is wired */}
        <button className="btn ghost" type="button" onClick={() => router.push('/dashboard')}>
          Skip login for now
        </button>
      </form>
    </section>
  );
}
