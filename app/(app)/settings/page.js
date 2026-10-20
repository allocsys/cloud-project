'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { account } from '@/lib/data';
import { useToast } from '@/components/Toast';
import { triggerHaptic } from '@/lib/haptics';
import { markDrill } from '@/lib/nav';
import { post, signOut, useApi } from '@/lib/api';
import Field from '@/components/Field';
import { applyTheme, readTheme } from '@/lib/theme';

const KYC = {
  none: { label: 'Not verified', cls: 'warn', cta: 'Verify' },
  pending: { label: 'In review', cls: '', cta: null },
  verified: { label: 'Verified', cls: 'ok', cta: null },
};

function Switch({ on, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className="switch" onClick={onChange}>
      <i />
    </button>
  );
}

export default function Settings() {
  const router = useRouter();
  const [toast, show] = useToast();
  const { data: sd, mutate: mutateSettings } = useApi('/api/settings', { ttl: 0 });
  const alerts = sd?.alerts || account.alerts;
  const { data: kd } = useApi('/api/kyc', { ttl: 30000 });
  const { data: me } = useApi('/api/auth/me', { ttl: 60000 });
  const [inst, setInst] = useState({ can: false, ios: false, standalone: true });
  const [theme, setTheme] = useState('dark');
  const [pwOpen, setPwOpen] = useState(false);
  const [cur, setCur] = useState('');
  const [nw, setNw] = useState('');
  const [pwErr, setPwErr] = useState({});
  const [pwBusy, setPwBusy] = useState(false);
  const [vbusy, setVbusy] = useState(false);

  useEffect(() => {
    setTheme(readTheme());
  }, []);

  function pickTheme(v) {
    triggerHaptic('selection');
    setTheme(v);
    applyTheme(v, true);
  }
  const kyc = KYC[kd ? kd.status : account.kyc] || KYC.none;


  // Install button: only when the browser offers the prompt (or on iOS, which needs a hint).
  useEffect(() => {
    const read = () =>
      setInst({
        can: !!window.__opusInstall,
        ios: /iphone|ipad|ipod/i.test(navigator.userAgent),
        standalone: window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
      });
    read();
    window.addEventListener('opus-install', read);
    return () => window.removeEventListener('opus-install', read);
  }, []);

  async function install() {
    triggerHaptic('light');
    const p = window.__opusInstall;
    if (p) {
      p.prompt();
      try {
        await p.userChoice;
      } catch {}
      window.__opusInstall = null;
      setInst((s) => ({ ...s, can: false }));
    } else {
      show('Tap Share, then Add to Home Screen');
    }
  }

  // The switch moves at once; if saving fails it goes back and says so.
  async function flipAlert(key) {
    triggerHaptic('selection');
    const before = alerts;
    mutateSettings({ ...(sd || {}), alerts: { ...before, [key]: !before[key] } });
    try {
      mutateSettings(await post('/api/settings', { alerts: { [key]: !before[key] } }));
    } catch (err) {
      triggerHaptic('error');
      mutateSettings({ ...(sd || {}), alerts: before });
      show(err.status ? err.message : 'No connection. Try again.');
    }
  }

  function togglePw() {
    triggerHaptic('selection');
    setPwOpen(!pwOpen);
    setCur('');
    setNw('');
    setPwErr({});
  }

  async function savePw(e) {
    e.preventDefault();
    if (pwBusy) return;
    const next = {};
    if (!cur) next.current = 'Enter your current password.';
    if (nw.length < 8) next.password = 'New password needs at least 8 characters.';
    if (next.current || next.password) {
      triggerHaptic('error');
      setPwErr(next);
      const el = document.getElementById(next.current ? 'pc' : 'pn');
      if (el) el.focus();
      return;
    }
    setPwErr({});
    setPwBusy(true);
    try {
      await post('/api/auth/password', { current: cur, password: nw });
      triggerHaptic('success');
      setPwOpen(false);
      setCur('');
      setNw('');
      show('Password updated');
    } catch (err) {
      triggerHaptic('error');
      setPwErr(err.field === 'current' || err.field === 'password' ? { [err.field]: err.message } : { form: err.status ? err.message : 'No connection. Try again.' });
    } finally {
      setPwBusy(false);
    }
  }

  async function sendVerify() {
    if (vbusy) return;
    triggerHaptic('light');
    setVbusy(true);
    try {
      await post('/api/auth/verify/resend', {});
      triggerHaptic('success');
      show('Check your inbox for the link');
    } catch (err) {
      triggerHaptic('error');
      show(err.status ? err.message : 'No connection. Try again.');
    } finally {
      setVbusy(false);
    }
  }

  function verify() {
    triggerHaptic('light');
    markDrill();
    router.push('/settings/kyc');
  }

  function handleSignOut() {
    triggerHaptic('medium');
    signOut();
    router.replace('/login');
  }

  return (
    <>
      <div className="top">
        <h2>Settings</h2>
      </div>
      <div className="grid wal" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="row" style={{ borderTop: 0 }}>
            <div>
              <div style={{ fontWeight: 500, fontSize: '13.5px' }}>Email</div>
              <small>{me ? me.email || (me.demo ? 'Demo account' : me.name ? `Telegram · ${me.name}` : 'Telegram account') : account.email}</small>
            </div>
            {me?.email &&
              (me.verified ? (
                <span className="badge ok">Verified</span>
              ) : me.mail ? (
                <button className="btn ghost" type="button" disabled={vbusy} onClick={sendVerify}>{vbusy ? 'Sending...' : 'Verify email'}</button>
              ) : (
                <span className="badge warn">Not verified</span>
              ))}
          </div>
          <div className="row">
            <div style={{ fontWeight: 500, fontSize: '13.5px' }}>Verification</div>
            {kyc.cta ? (
              <button className="btn ghost" type="button" onClick={verify}>{kyc.cta}</button>
            ) : (
              <span className={`badge ${kyc.cls}`}>{kyc.label}</span>
            )}
          </div>
          <div className="row">
            <div style={{ fontWeight: 500, fontSize: '13.5px' }}>Two-factor</div>
            <span className="badge">Coming soon</span>
          </div>
          {me?.email && (
            <>
              <div className="row">
                <div style={{ fontWeight: 500, fontSize: '13.5px' }}>Password</div>
                <button className="btn ghost" type="button" aria-expanded={pwOpen} onClick={togglePw}>{pwOpen ? 'Cancel' : 'Change'}</button>
              </div>
              {pwOpen && (
                <form onSubmit={savePw} noValidate style={{ paddingBottom: '8px' }}>
                  <Field id="pc" label="Current password" error={pwErr.current}>
                    <input
                      id="pc"
                      type="password"
                      className={pwErr.current ? 'bad' : undefined}
                      aria-invalid={!!pwErr.current}
                      aria-describedby={pwErr.current ? 'pc-err' : undefined}
                      autoComplete="current-password"
                      value={cur}
                      onChange={(e) => {
                        setCur(e.target.value);
                        if (pwErr.current) setPwErr({ ...pwErr, current: undefined });
                      }}
                    />
                  </Field>
                  <Field id="pn" label="New password" error={pwErr.password}>
                    <input
                      id="pn"
                      type="password"
                      className={pwErr.password ? 'bad' : undefined}
                      aria-invalid={!!pwErr.password}
                      aria-describedby={pwErr.password ? 'pn-err' : undefined}
                      autoComplete="new-password"
                      placeholder="At least 8 characters"
                      value={nw}
                      onChange={(e) => {
                        setNw(e.target.value);
                        if (pwErr.password) setPwErr({ ...pwErr, password: undefined });
                      }}
                    />
                  </Field>
                  {pwErr.form && <div className="ferr" role="alert">{pwErr.form}</div>}
                  <button className="btn" type="submit" disabled={pwBusy} style={{ marginTop: '10px' }}>
                    {pwBusy ? 'Updating...' : 'Update password'}
                  </button>
                </form>
              )}
            </>
          )}
          {!inst.standalone && (inst.can || inst.ios) && (
            <div className="row">
              <div>
                <div style={{ fontWeight: 500, fontSize: '13.5px' }}>Install app</div>
                <small>Add Opus to your home screen</small>
              </div>
              <button className="btn ghost" type="button" onClick={install}>Install</button>
            </div>
          )}
        </div>

        <div className="card">
          <div className="row" style={{ borderTop: 0 }}>
            <div style={{ fontWeight: 500, fontSize: '13.5px' }}>Theme</div>
            <div className="minitabs" role="group" aria-label="Theme">
              {[
                ['dark', 'Dark'],
                ['light', 'Light'],
                ['system', 'Auto'],
              ].map(([v, label]) => (
                <button key={v} type="button" aria-pressed={theme === v} onClick={() => pickTheme(v)}>{label}</button>
              ))}
            </div>
          </div>
          {[
            ['payouts', 'Payout alerts'],
            ['withdrawals', 'Withdrawal alerts'],
            ['news', 'Product news'],
          ].map(([key, title]) => (
            <div key={key} className="row">
              <div style={{ fontWeight: 500, fontSize: '13.5px' }}>{title}</div>
              <Switch on={alerts[key]} onChange={() => flipAlert(key)} label={title} />
            </div>
          ))}
          <button className="btn ghost" type="button" onClick={handleSignOut} style={{ marginTop: '8px' }}>Sign out</button>
        </div>
      </div>
      {toast}
    </>
  );
}
