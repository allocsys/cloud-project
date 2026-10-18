'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { account } from '@/lib/data';
import { useToast } from '@/components/Toast';
import { triggerHaptic } from '@/lib/haptics';
import { markDrill } from '@/lib/nav';
import { signOut, useApi } from '@/lib/api';
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
  const [twofa, setTwofa] = useState(account.twofa);
  const [alerts, setAlerts] = useState(account.alerts);
  const { data: kd } = useApi('/api/kyc', { ttl: 30000 });
  const { data: me } = useApi('/api/auth/me', { ttl: 60000 });
  const [inst, setInst] = useState({ can: false, ios: false, standalone: true });
  const [theme, setTheme] = useState('dark');

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

  // TODO: persist these through your API.
  function flip2fa() {
    triggerHaptic('selection');
    setTwofa(!twofa);
  }

  function flipAlert(key) {
    triggerHaptic('selection');
    setAlerts({ ...alerts, [key]: !alerts[key] });
  }

  function todo(msg) {
    triggerHaptic('light');
    show(msg);
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
              <small>{me ? me.email || 'Demo account' : account.email}</small>
            </div>
            <button className="btn ghost" type="button" onClick={() => todo('Coming soon')}>Change</button>
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
            <Switch on={twofa} onChange={flip2fa} label="Two-factor authentication" />
          </div>
          <div className="row">
            <div style={{ fontWeight: 500, fontSize: '13.5px' }}>Password</div>
            <button className="btn ghost" type="button" onClick={() => todo('Coming soon')}>Change</button>
          </div>
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
