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
    show(twofa ? 'Two-factor off' : 'Two-factor on');
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
    router.push('/login');
  }

  return (
    <>
      <div className="top">
        <h2>Settings</h2>
      </div>
      <div className="grid wal">
        <div className="grid" style={{ alignContent: 'start' }}>
          <div className="card">
            <div className="cardhead"><span className="sethead">Account</span></div>
            <div className="row">
              <div>
                <div style={{ fontWeight: 500 }}>Email</div>
                <small>{account.email}</small>
              </div>
              <button className="btn ghost" type="button" onClick={() => todo('Email change coming soon')}>Change</button>
            </div>
            <div className="row">
              <div>
                <div style={{ fontWeight: 500 }}>Identity verification</div>
                <small>Raises your withdrawal limit</small>
              </div>
              {kyc.cta ? (
                <button className="btn ghost" type="button" onClick={() => todo('Verification flow coming soon')}>{kyc.cta}</button>
              ) : (
                <span className={`badge ${kyc.cls}`}>{kyc.label}</span>
              )}
            </div>
          </div>

          <div className="card">
            <div className="cardhead"><span className="sethead">Security</span></div>
            <div className="row">
              <div>
                <div style={{ fontWeight: 500 }}>Two-factor authentication</div>
                <small>{twofa ? 'On' : 'Off'}</small>
              </div>
              <Switch on={twofa} onChange={flip2fa} label="Two-factor authentication" />
            </div>
            <div className="row">
              <div style={{ fontWeight: 500 }}>Password</div>
              <button className="btn ghost" type="button" onClick={() => todo('Password change coming soon')}>Change</button>
            </div>
          </div>
        </div>

        <div className="grid" style={{ alignContent: 'start' }}>
          <div className="card">
            <div className="cardhead"><span className="sethead">Notifications</span></div>
            {[
              ['payouts', 'Daily payouts', 'When your earnings are credited'],
              ['withdrawals', 'Withdrawals', 'Confirmations and status changes'],
              ['news', 'Product news', 'New plans and features'],
            ].map(([key, title, desc]) => (
              <div key={key} className="row">
                <div>
                  <div style={{ fontWeight: 500 }}>{title}</div>
                  <small>{desc}</small>
                </div>
                <Switch on={alerts[key]} onChange={() => flipAlert(key)} label={title} />
              </div>
            ))}
          </div>

          <div className="card">
            <button className="btn ghost" type="button" onClick={signOut}>Sign out</button>
            <div className="version">Opus Cloud Mining</div>
          </div>
        </div>
      </div>
      {toast}
    </>
  );
}
