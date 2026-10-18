'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { account } from '@/lib/data';
import { useToast } from '@/components/Toast';
import { triggerHaptic } from '@/lib/haptics';

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
  const kyc = KYC[account.kyc];

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

  function signOut() {
    triggerHaptic('medium');
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
              <small>{account.email}</small>
            </div>
            <button className="btn ghost" type="button" onClick={() => todo('Coming soon')}>Change</button>
          </div>
          <div className="row">
            <div style={{ fontWeight: 500, fontSize: '13.5px' }}>Verification</div>
            {kyc.cta ? (
              <button className="btn ghost" type="button" onClick={() => todo('Coming soon')}>{kyc.cta}</button>
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
        </div>

        <div className="card">
          {[
            ['payouts', 'Payout alerts'],
            ['withdrawals', 'Withdrawal alerts'],
            ['news', 'Product news'],
          ].map(([key, title], i) => (
            <div key={key} className="row" style={i === 0 ? { borderTop: 0 } : undefined}>
              <div style={{ fontWeight: 500, fontSize: '13.5px' }}>{title}</div>
              <Switch on={alerts[key]} onChange={() => flipAlert(key)} label={title} />
            </div>
          ))}
          <button className="btn ghost" type="button" onClick={signOut} style={{ marginTop: '8px' }}>Sign out</button>
        </div>
      </div>
      {toast}
    </>
  );
}
