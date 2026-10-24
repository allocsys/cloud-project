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
  const { data: me, refresh: refreshMe } = useApi('/api/auth/me', { ttl: 60000 });
  const [inst, setInst] = useState({ can: false, ios: false, standalone: true });
  const [theme, setTheme] = useState('dark');
  const [pwOpen, setPwOpen] = useState(false);
  const [cur, setCur] = useState('');
  const [nw, setNw] = useState('');
  const [pwErr, setPwErr] = useState({});
  const [pwBusy, setPwBusy] = useState(false);
  const [vbusy, setVbusy] = useState(false);
  // Two-factor panel: null (closed), 'setup' (key shown, waiting for the first code), 'codes' (recovery codes, shown once), 'off'.
  const [tf, setTf] = useState(null);
  const [tfKey, setTfKey] = useState({ secret: '', uri: '' });
  const [tfCode, setTfCode] = useState('');
  const [tfPw, setTfPw] = useState('');
  const [tfErr, setTfErr] = useState({});
  const [tfBusy, setTfBusy] = useState(false);
  const [tfCodes, setTfCodes] = useState([]);
  const tfOn = !!me?.twofa;
  // Close-account panel: null (closed), or what the server says closing would do.
  const [cl, setCl] = useState(null);
  const [clPw, setClPw] = useState('');
  const [clCode, setClCode] = useState('');
  const [clText, setClText] = useState('');
  const [clForfeit, setClForfeit] = useState(false);
  const [clErr, setClErr] = useState({});
  const [clBusy, setClBusy] = useState(false);

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

  function closeTf() {
    setTf(null);
    setTfKey({ secret: '', uri: '' });
    setTfCode('');
    setTfPw('');
    setTfErr({});
    setTfCodes([]);
  }

  // Asks the server for a new key; nothing is on until the first code from the app is accepted.
  async function startTf() {
    if (tfBusy) return;
    triggerHaptic('selection');
    if (tf) return closeTf();
    setTfBusy(true);
    try {
      const r = await post('/api/auth/2fa', { action: 'start' });
      setTfKey({ secret: r.secret, uri: r.uri });
      setTf('setup');
    } catch (err) {
      triggerHaptic('error');
      show(err.status ? err.message : 'No connection. Try again.');
    } finally {
      setTfBusy(false);
    }
  }

  function openOff() {
    triggerHaptic('selection');
    const was = tf === 'off';
    closeTf();
    if (!was) setTf('off');
  }

  async function enableTf(e) {
    e.preventDefault();
    if (tfBusy) return;
    if (!tfCode.trim()) return setTfErr({ code: 'Enter the 6-digit code from the app.' });
    setTfErr({});
    setTfBusy(true);
    try {
      const r = await post('/api/auth/2fa', { action: 'enable', code: tfCode.trim() });
      triggerHaptic('success');
      setTfCodes(r.codes || []);
      setTfCode('');
      setTfKey({ secret: '', uri: '' });
      setTf('codes');
      refreshMe();
    } catch (err) {
      triggerHaptic('error');
      setTfErr(err.field === 'code' ? { code: err.message } : { form: err.status ? err.message : 'No connection. Try again.' });
    } finally {
      setTfBusy(false);
    }
  }

  async function disableTf(e) {
    e.preventDefault();
    if (tfBusy) return;
    const next = {};
    if (!tfPw) next.password = 'Enter your password.';
    if (!tfCode.trim()) next.code = 'Enter a code from the app, or a recovery code.';
    if (next.password || next.code) return setTfErr(next);
    setTfErr({});
    setTfBusy(true);
    try {
      await post('/api/auth/2fa', { action: 'disable', password: tfPw, code: tfCode.trim() });
      triggerHaptic('success');
      closeTf();
      refreshMe();
      show('Two-factor is off');
    } catch (err) {
      triggerHaptic('error');
      setTfErr(err.field === 'code' || err.field === 'password' ? { [err.field]: err.message } : { form: err.status ? err.message : 'No connection. Try again.' });
    } finally {
      setTfBusy(false);
    }
  }

  async function copyCodes() {
    triggerHaptic('light');
    try {
      await navigator.clipboard.writeText(tfCodes.join('\n'));
      show('Copied');
    } catch {
      show('Could not copy. Select the codes and copy them by hand.');
    }
  }

  function resetClose() {
    setCl(null);
    setClPw('');
    setClCode('');
    setClText('');
    setClForfeit(false);
    setClErr({});
  }

  async function openClose() {
    triggerHaptic('selection');
    if (cl) return resetClose();
    let r;
    try {
      r = await fetch('/api/account', { headers: { accept: 'application/json' } });
    } catch {
      triggerHaptic('error');
      return show('No connection. Try again.');
    }
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) {
      triggerHaptic('error');
      return show(j?.error || 'Something went wrong.');
    }
    setCl(j);
  }

  async function submitClose(e) {
    e.preventDefault();
    if (clBusy || !cl || cl.blocked) return;
    const next = {};
    if (cl.password && !clPw) next.password = 'Enter your password.';
    if (cl.twofa && !clCode.trim()) next.code = 'Enter a code from the app, or a recovery code.';
    if (clText.trim().toUpperCase() !== 'DELETE') next.confirm = 'Type DELETE to confirm.';
    if (cl.miners > 0 && !clForfeit) next.forfeit = 'Tick the box to continue.';
    if (Object.keys(next).length) {
      triggerHaptic('error');
      return setClErr(next);
    }
    setClErr({});
    setClBusy(true);
    try {
      await post('/api/account', { password: clPw, code: clCode.trim(), confirm: clText.trim(), forfeit: clForfeit });
      triggerHaptic('success');
      await signOut();
      window.location.assign('/'); // a fresh load, so the home page shows the signed-out version
    } catch (err) {
      triggerHaptic('error');
      setClErr(err.field === 'password' || err.field === 'code' ? { [err.field]: err.message } : { form: err.status ? err.message : 'No connection. Try again.' });
    } finally {
      setClBusy(false);
    }
  }

  function verify() {
    triggerHaptic('light');
    markDrill();
    router.push('/settings/kyc');
  }

  async function handleSignOut() {
    triggerHaptic('medium');
    await signOut();
    window.location.assign('/'); // a fresh load, so the home page shows the signed-out version
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
          {me?.email && (
            <>
              <div className="row">
                <div>
                  <div style={{ fontWeight: 500, fontSize: '13.5px' }}>Two-factor</div>
                  <small>{tfOn ? 'On. Sign-in asks for a code.' : 'A code from an authenticator app at sign-in'}</small>
                </div>
                <Switch on={tfOn} onChange={tfOn ? openOff : startTf} label="Two-factor" />
              </div>
              {tf === 'setup' && (
                <form onSubmit={enableTf} noValidate style={{ paddingBottom: '8px' }}>
                  <small style={{ display: 'block', marginBottom: '8px' }}>Add this key to an authenticator app (Google Authenticator, Authy, 1Password), then type the 6-digit code it shows.</small>
                  <div style={{ fontFamily: 'monospace', fontSize: '13px', wordBreak: 'break-all', userSelect: 'all', padding: '10px 12px', borderRadius: '10px', background: 'rgba(128,128,128,.12)' }}>
                    {tfKey.secret.replace(/(.{4})/g, '$1 ').trim()}
                  </div>
                  <a className="btn ghost" href={tfKey.uri} style={{ display: 'inline-block', marginTop: '8px', textDecoration: 'none', textAlign: 'center' }}>Open in authenticator app</a>
                  <Field id="tf" label="6-digit code" error={tfErr.code}>
                    <input
                      id="tf"
                      className={tfErr.code ? 'bad' : undefined}
                      aria-invalid={!!tfErr.code}
                      aria-describedby={tfErr.code ? 'tf-err' : undefined}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="123456"
                      value={tfCode}
                      onChange={(e) => {
                        setTfCode(e.target.value);
                        if (tfErr.code) setTfErr({ ...tfErr, code: undefined });
                      }}
                    />
                  </Field>
                  {tfErr.form && <div className="ferr" role="alert">{tfErr.form}</div>}
                  <button className="btn" type="submit" disabled={tfBusy} style={{ marginTop: '10px' }}>{tfBusy ? 'Checking...' : 'Turn on'}</button>
                </form>
              )}
              {tf === 'codes' && (
                <div style={{ paddingBottom: '8px' }}>
                  <small style={{ display: 'block' }}>Two-factor is on. Save these recovery codes somewhere safe. Each works once if you lose your phone, and they are not shown again.</small>
                  <div style={{ fontFamily: 'monospace', fontSize: '13px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px', margin: '10px 0', userSelect: 'all' }}>
                    {tfCodes.map((c) => (
                      <span key={c}>{c}</span>
                    ))}
                  </div>
                  <button className="btn ghost" type="button" onClick={copyCodes}>Copy codes</button>
                  <button className="btn" type="button" onClick={() => { triggerHaptic('light'); closeTf(); }} style={{ marginTop: '10px' }}>I saved them</button>
                </div>
              )}
              {tf === 'off' && (
                <form onSubmit={disableTf} noValidate style={{ paddingBottom: '8px' }}>
                  <Field id="tp" label="Password" error={tfErr.password}>
                    <input
                      id="tp"
                      type="password"
                      className={tfErr.password ? 'bad' : undefined}
                      aria-invalid={!!tfErr.password}
                      aria-describedby={tfErr.password ? 'tp-err' : undefined}
                      autoComplete="current-password"
                      value={tfPw}
                      onChange={(e) => {
                        setTfPw(e.target.value);
                        if (tfErr.password) setTfErr({ ...tfErr, password: undefined });
                      }}
                    />
                  </Field>
                  <Field id="tk" label="Code" error={tfErr.code}>
                    <input
                      id="tk"
                      className={tfErr.code ? 'bad' : undefined}
                      aria-invalid={!!tfErr.code}
                      aria-describedby={tfErr.code ? 'tk-err' : undefined}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      autoCapitalize="none"
                      placeholder="6-digit code, or a recovery code"
                      value={tfCode}
                      onChange={(e) => {
                        setTfCode(e.target.value);
                        if (tfErr.code) setTfErr({ ...tfErr, code: undefined });
                      }}
                    />
                  </Field>
                  {tfErr.form && <div className="ferr" role="alert">{tfErr.form}</div>}
                  <button className="btn" type="submit" disabled={tfBusy} style={{ marginTop: '10px' }}>{tfBusy ? 'Turning off...' : 'Turn off two-factor'}</button>
                </form>
              )}
            </>
          )}
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
          {me && !me.demo && (
            <>
              <div className="row">
                <div>
                  <div style={{ fontWeight: 500, fontSize: '13.5px' }}>Close account</div>
                  <small>Erases your sign-in details and personal data</small>
                </div>
                <button className="btn ghost" type="button" aria-expanded={!!cl} onClick={openClose}>{cl ? 'Cancel' : 'Close'}</button>
              </div>
              {cl && (
                <form onSubmit={submitClose} noValidate style={{ paddingBottom: '8px' }}>
                  {cl.blocked ? (
                    <div className="ferr" role="alert">{cl.blocked}</div>
                  ) : (
                    <>
                      <small style={{ display: 'block', marginBottom: '8px' }}>
                        This cannot be undone. Your email, password, name and verification details are erased and you are signed out everywhere. Payment and withdrawal records are kept without your email, as the Privacy Policy explains. Any balance below the withdrawal minimum is lost. You can sign up again later, but you start from nothing.
                      </small>
                      {cl.miners > 0 && (
                        <>
                          <label style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: '13px', margin: '8px 0' }}>
                            <input type="checkbox" checked={clForfeit} onChange={(e) => { setClForfeit(e.target.checked); if (clErr.forfeit) setClErr({ ...clErr, forfeit: undefined }); }} style={{ marginTop: '3px' }} />
                            <span>My {cl.miners} running miner{cl.miners === 1 ? '' : 's'} will end with no refund.</span>
                          </label>
                          {clErr.forfeit && <div className="ferr" role="alert">{clErr.forfeit}</div>}
                        </>
                      )}
                      {cl.password && (
                        <Field id="cp" label="Password" error={clErr.password}>
                          <input
                            id="cp"
                            type="password"
                            className={clErr.password ? 'bad' : undefined}
                            aria-invalid={!!clErr.password}
                            aria-describedby={clErr.password ? 'cp-err' : undefined}
                            autoComplete="current-password"
                            value={clPw}
                            onChange={(e) => {
                              setClPw(e.target.value);
                              if (clErr.password) setClErr({ ...clErr, password: undefined });
                            }}
                          />
                        </Field>
                      )}
                      {cl.twofa && (
                        <Field id="ck" label="Code" error={clErr.code}>
                          <input
                            id="ck"
                            className={clErr.code ? 'bad' : undefined}
                            aria-invalid={!!clErr.code}
                            aria-describedby={clErr.code ? 'ck-err' : undefined}
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            autoCapitalize="none"
                            placeholder="6-digit code, or a recovery code"
                            value={clCode}
                            onChange={(e) => {
                              setClCode(e.target.value);
                              if (clErr.code) setClErr({ ...clErr, code: undefined });
                            }}
                          />
                        </Field>
                      )}
                      <Field id="cd" label="Type DELETE to confirm" error={clErr.confirm}>
                        <input
                          id="cd"
                          className={clErr.confirm ? 'bad' : undefined}
                          aria-invalid={!!clErr.confirm}
                          aria-describedby={clErr.confirm ? 'cd-err' : undefined}
                          autoCapitalize="characters"
                          autoComplete="off"
                          value={clText}
                          onChange={(e) => {
                            setClText(e.target.value);
                            if (clErr.confirm) setClErr({ ...clErr, confirm: undefined });
                          }}
                        />
                      </Field>
                      {clErr.form && <div className="ferr" role="alert">{clErr.form}</div>}
                      <button className="btn" type="submit" disabled={clBusy} style={{ marginTop: '10px' }}>{clBusy ? 'Closing...' : 'Close my account'}</button>
                    </>
                  )}
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
