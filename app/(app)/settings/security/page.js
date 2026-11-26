'use client';
import { useState } from 'react';
import { account } from '@/lib/data';
import { useToast } from '@/components/Toast';
import { triggerHaptic } from '@/components/haptics';
import { post, signOut, useApi } from '@/components/api';
import Field from '@/components/Field';
import { useT, useLang } from '@/components/I18nProvider';
import { translateError } from '@/lib/i18n/errors';
import { Qr } from '@/components/Qr';
import { useWaiting } from '@/components/Skeleton';
import { PH_ME } from '@/components/placeholder';
import { LevelBadge, SubHead, Switch } from '@/components/SettingsKit';

export default function Security() {
  const t = useT();
  const { lang } = useLang();
  const [toast, show] = useToast();
  const { data: meLive, refresh: refreshMe } = useApi('/api/auth/me', { ttl: 60000 });
  const waitMe = useWaiting(!meLive);
  // Until the account answers, the page draws itself with placeholder data in the loading look (components/placeholder.js, .ld).
  const me = meLive || (waitMe ? PH_ME : undefined);
  const [pwOpen, setPwOpen] = useState(false);
  const [cur, setCur] = useState('');
  const [nw, setNw] = useState('');
  const [pwErr, setPwErr] = useState({});
  const [pwBusy, setPwBusy] = useState(false);
  const [vbusy, setVbusy] = useState(false);
  // Add-email panel (Telegram accounts): null (closed), 'form' (email and password), 'code' (waiting for the mailed code).
  const [em, setEm] = useState(null);
  const [emMail, setEmMail] = useState('');
  const [emPw, setEmPw] = useState('');
  const [emCode, setEmCode] = useState('');
  const [emErr, setEmErr] = useState({});
  const [emBusy, setEmBusy] = useState(false);
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
    if (!cur) next.current = t('set.eCur');
    if (nw.length < 8) next.password = t('set.eNewPw');
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
      show(t('set.pwUpdated'));
    } catch (err) {
      triggerHaptic('error');
      setPwErr(err.field === 'current' || err.field === 'password' ? { [err.field]: err.message } : { form: err.status ? err.message : t('common.noConnection') });
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
      show(t('set.checkInbox'));
    } catch (err) {
      triggerHaptic('error');
      show(err.status ? err.message : t('common.noConnection'));
    } finally {
      setVbusy(false);
    }
  }

  function closeEm() {
    setEm(null);
    setEmMail('');
    setEmPw('');
    setEmCode('');
    setEmErr({});
  }

  function toggleEm() {
    triggerHaptic('selection');
    if (em) return closeEm();
    setEm('form');
  }

  async function sendEmCode(e) {
    e.preventDefault();
    if (emBusy) return;
    const next = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emMail.trim())) next.email = t('auth.errEmail');
    if (emPw.length < 8) next.password = t('auth.errPassword');
    if (next.email || next.password) {
      triggerHaptic('error');
      return setEmErr(next);
    }
    setEmErr({});
    setEmBusy(true);
    try {
      await post('/api/auth/email', { action: 'start', email: emMail.trim(), password: emPw });
      triggerHaptic('success');
      setEmCode('');
      setEm('code');
    } catch (err) {
      triggerHaptic('error');
      setEmErr(err.field === 'email' || err.field === 'password' ? { [err.field]: err.message } : { form: err.status ? err.message : t('common.noConnection') });
    } finally {
      setEmBusy(false);
    }
  }

  async function confirmEm(e) {
    e.preventDefault();
    if (emBusy) return;
    if (emCode.replace(/\D/g, '').length !== 6) return setEmErr({ code: t('set.eCode6') });
    setEmErr({});
    setEmBusy(true);
    try {
      await post('/api/auth/email', { action: 'confirm', code: emCode });
      triggerHaptic('success');
      closeEm();
      refreshMe();
      show(t('set.emailAdded'));
    } catch (err) {
      triggerHaptic('error');
      setEmErr(err.field === 'code' || err.field === 'email' ? { [err.field]: err.message } : { form: err.status ? err.message : t('common.noConnection') });
    } finally {
      setEmBusy(false);
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
      show(err.status ? err.message : t('common.noConnection'));
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
    if (!tfCode.trim()) return setTfErr({ code: t('set.eCodeApp') });
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
      setTfErr(err.field === 'code' ? { code: err.message } : { form: err.status ? err.message : t('common.noConnection') });
    } finally {
      setTfBusy(false);
    }
  }

  async function disableTf(e) {
    e.preventDefault();
    if (tfBusy) return;
    const next = {};
    if (!tfPw) next.password = t('set.ePw');
    if (!tfCode.trim()) next.code = t('set.eCodeRec');
    if (next.password || next.code) return setTfErr(next);
    setTfErr({});
    setTfBusy(true);
    try {
      await post('/api/auth/2fa', { action: 'disable', password: tfPw, code: tfCode.trim() });
      triggerHaptic('success');
      closeTf();
      refreshMe();
      show(t('set.tfOffToast'));
    } catch (err) {
      triggerHaptic('error');
      setTfErr(err.field === 'code' || err.field === 'password' ? { [err.field]: err.message } : { form: err.status ? err.message : t('common.noConnection') });
    } finally {
      setTfBusy(false);
    }
  }

  async function copyKey() {
    triggerHaptic('light');
    try {
      await navigator.clipboard.writeText(tfKey.secret);
      show(t('set.copied'));
    } catch {
      show(t('set.copyFail'));
    }
  }

  async function copyCodes() {
    triggerHaptic('light');
    try {
      await navigator.clipboard.writeText(tfCodes.join('\n'));
      show(t('set.copied'));
    } catch {
      show(t('set.copyFail'));
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
      return show(t('common.noConnection'));
    }
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) {
      triggerHaptic('error');
      return show(j?.error ? translateError(lang, j.error) : t('set.wrong'));
    }
    setCl(j);
  }

  async function submitClose(e) {
    e.preventDefault();
    if (clBusy || !cl || cl.blocked) return;
    const next = {};
    if (cl.password && !clPw) next.password = t('set.ePw');
    if (cl.twofa && !clCode.trim()) next.code = t('set.eCodeRec');
    if (clText.trim().toUpperCase() !== 'DELETE') next.confirm = t('set.eDel');
    if (cl.miners > 0 && !clForfeit) next.forfeit = t('set.eTick');
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
      setClErr(err.field === 'password' || err.field === 'code' ? { [err.field]: err.message } : { form: err.status ? err.message : t('common.noConnection') });
    } finally {
      setClBusy(false);
    }
  }


  return (
    <>
      <SubHead title={t('set.security')} />
      <div className={waitMe ? 'grid wal ld' : 'grid wal'} aria-busy={waitMe || undefined} style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="row" style={{ borderTop: 0 }}>
            <div className="set-t">{t('set.level')}</div>
            {me && <LevelBadge me={me} />}
          </div>
          <div className="row">
            <div>
              <div style={{ fontWeight: 500, fontSize: '13.5px' }}>{me && !me.email ? t('set.account') : t('auth.email')}</div>
              <small>{me ? me.email || (me.demo ? t('set.demo') : me.name ? t('set.tg', { name: me.name }) : t('set.tgAcc')) : account.email}</small>
            </div>
            {me?.email &&
              (me.verified ? (
                <span className="badge ok">{t('kyc.verified')}</span>
              ) : me.mail ? (
                <button className="btn ghost" type="button" disabled={vbusy} onClick={sendVerify}>{vbusy ? t('auth.sending') : t('set.verifyEmail')}</button>
              ) : (
                <span className="badge warn">{t('set.notVerified')}</span>
              ))}
          </div>
          {me?.telegram && !me.email && me.mail && (
            <>
              <div className="row">
                <div>
                  <div style={{ fontWeight: 500, fontSize: '13.5px' }}>{t('set.addEmail')}</div>
                  <small>{t('set.addEmailSub')}</small>
                </div>
                <button className="btn ghost" type="button" aria-expanded={!!em} onClick={toggleEm}>{em ? t('common.cancel') : t('set.add')}</button>
              </div>
              {em === 'form' && (
                <form onSubmit={sendEmCode} noValidate style={{ paddingBottom: '8px' }}>
                  <Field id="em" label={t('auth.email')} error={emErr.email}>
                    <input
                      id="em"
                      type="email"
                      className={emErr.email ? 'bad' : undefined}
                      aria-invalid={!!emErr.email}
                      aria-describedby={emErr.email ? 'em-err' : undefined}
                      autoComplete="email"
                      autoCapitalize="none"
                      value={emMail}
                      onChange={(e) => {
                        setEmMail(e.target.value);
                        if (emErr.email) setEmErr({ ...emErr, email: undefined });
                      }}
                    />
                  </Field>
                  <Field id="ep" label={t('auth.password')} error={emErr.password}>
                    <input
                      id="ep"
                      type="password"
                      className={emErr.password ? 'bad' : undefined}
                      aria-invalid={!!emErr.password}
                      aria-describedby={emErr.password ? 'ep-err' : undefined}
                      autoComplete="new-password"
                      placeholder={t('auth.pwPlaceholder')}
                      value={emPw}
                      onChange={(e) => {
                        setEmPw(e.target.value);
                        if (emErr.password) setEmErr({ ...emErr, password: undefined });
                      }}
                    />
                  </Field>
                  {emErr.form && <div className="ferr" role="alert">{emErr.form}</div>}
                  <button className="btn" type="submit" disabled={emBusy} style={{ marginTop: '10px' }}>{emBusy ? t('auth.sending') : t('set.sendCode')}</button>
                </form>
              )}
              {em === 'code' && (
                <form onSubmit={confirmEm} noValidate style={{ paddingBottom: '8px' }}>
                  <small style={{ display: 'block', marginBottom: '8px' }}>{t('set.weSent', { email: emMail.trim().toLowerCase() })}</small>
                  <Field id="ec" label={t('set.code6')} error={emErr.code}>
                    <input
                      id="ec"
                      className={emErr.code ? 'bad' : undefined}
                      aria-invalid={!!emErr.code}
                      aria-describedby={emErr.code ? 'ec-err' : undefined}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="123456"
                      value={emCode}
                      onChange={(e) => {
                        setEmCode(e.target.value);
                        if (emErr.code) setEmErr({ ...emErr, code: undefined });
                      }}
                    />
                  </Field>
                  {emErr.form && <div className="ferr" role="alert">{emErr.form}</div>}
                  <button className="btn" type="submit" disabled={emBusy} style={{ marginTop: '10px' }}>{emBusy ? t('set.checking') : t('set.confirm')}</button>
                </form>
              )}
            </>
          )}
          {me?.email && (
            <>
              <div className="row">
                <div>
                  <div style={{ fontWeight: 500, fontSize: '13.5px' }}>{t('set.twofa')}</div>
                  <small>{tfOn ? t('set.twofaOn') : t('set.twofaOff')}</small>
                </div>
                <Switch on={tfOn} onChange={tfOn ? openOff : startTf} label={t('set.twofa')} />
              </div>
              {tf === 'setup' && (
                <form onSubmit={enableTf} noValidate style={{ paddingBottom: '8px' }}>
                  <small style={{ display: 'block', marginBottom: '8px' }}>{t('set.tfAdd')}</small>
                  <div style={{ fontFamily: 'monospace', fontSize: '13px', wordBreak: 'break-all', userSelect: 'all', padding: '10px 12px', borderRadius: '10px', background: 'rgba(128,128,128,.12)' }}>
                    {tfKey.secret.replace(/(.{4})/g, '$1 ').trim()}
                  </div>
                  {/* The QR carries only the key (a short link): the full account link is too long for the small encoder. */}
                  <Qr value={`otpauth://totp/Vertexhash?secret=${tfKey.secret}&issuer=Vertexhash`} />
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
                  <button type="button" className="btn ghost" style={{ display: 'inline-block', textAlign: 'center' }} onClick={copyKey}>
                    {t('set.copyKey')}
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    style={{ display: 'inline-block', textAlign: 'center' }}
                    onClick={() => {
                      try {
                        const f = document.createElement('iframe');
                        f.style.display = 'none';
                        f.src = tfKey.uri;
                        document.body.appendChild(f);
                        setTimeout(() => f.remove(), 3000);
                      } catch {}
                    }}
                  >
                    {t('set.tfOpen')}
                  </button>
                  </div>
                  <Field id="tf" label={t('set.code6')} error={tfErr.code}>
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
                  <button className="btn" type="submit" disabled={tfBusy} style={{ marginTop: '10px' }}>{tfBusy ? t('set.checking') : t('set.tfOn')}</button>
                </form>
              )}
              {tf === 'codes' && (
                <div style={{ paddingBottom: '8px' }}>
                  <small style={{ display: 'block' }}>{t('set.tfCodes')}</small>
                  <div style={{ fontFamily: 'monospace', fontSize: '13px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px', margin: '10px 0', userSelect: 'all' }}>
                    {tfCodes.map((c) => (
                      <span key={c}>{c}</span>
                    ))}
                  </div>
                  <button className="btn ghost" type="button" onClick={copyCodes}>{t('set.copyCodes')}</button>
                  <button className="btn" type="button" onClick={() => { triggerHaptic('light'); closeTf(); }} style={{ marginTop: '10px' }}>{t('set.saved')}</button>
                </div>
              )}
              {tf === 'off' && (
                <form onSubmit={disableTf} noValidate style={{ paddingBottom: '8px' }}>
                  <Field id="tp" label={t('auth.password')} error={tfErr.password}>
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
                  <Field id="tk" label={t('set.code')} error={tfErr.code}>
                    <input
                      id="tk"
                      className={tfErr.code ? 'bad' : undefined}
                      aria-invalid={!!tfErr.code}
                      aria-describedby={tfErr.code ? 'tk-err' : undefined}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      autoCapitalize="none"
                      placeholder={t('auth.codePlaceholder')}
                      value={tfCode}
                      onChange={(e) => {
                        setTfCode(e.target.value);
                        if (tfErr.code) setTfErr({ ...tfErr, code: undefined });
                      }}
                    />
                  </Field>
                  {tfErr.form && <div className="ferr" role="alert">{tfErr.form}</div>}
                  <button className="btn" type="submit" disabled={tfBusy} style={{ marginTop: '10px' }}>{tfBusy ? t('set.turningOff') : t('set.turnOff')}</button>
                </form>
              )}
            </>
          )}
          {me?.email && (
            <>
              <div className="row">
                <div style={{ fontWeight: 500, fontSize: '13.5px' }}>{t('auth.password')}</div>
                <button className="btn ghost" type="button" aria-expanded={pwOpen} onClick={togglePw}>{pwOpen ? t('common.cancel') : t('set.change')}</button>
              </div>
              {pwOpen && (
                <form onSubmit={savePw} noValidate style={{ paddingBottom: '8px' }}>
                  <Field id="pc" label={t('set.curPw')} error={pwErr.current}>
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
                  <Field id="pn" label={t('auth.newPassword')} error={pwErr.password}>
                    <input
                      id="pn"
                      type="password"
                      className={pwErr.password ? 'bad' : undefined}
                      aria-invalid={!!pwErr.password}
                      aria-describedby={pwErr.password ? 'pn-err' : undefined}
                      autoComplete="new-password"
                      placeholder={t('auth.pwPlaceholder')}
                      value={nw}
                      onChange={(e) => {
                        setNw(e.target.value);
                        if (pwErr.password) setPwErr({ ...pwErr, password: undefined });
                      }}
                    />
                  </Field>
                  {pwErr.form && <div className="ferr" role="alert">{pwErr.form}</div>}
                  <button className="btn" type="submit" disabled={pwBusy} style={{ marginTop: '10px' }}>
                    {pwBusy ? t('set.updating') : t('set.update')}
                  </button>
                </form>
              )}
            </>
          )}
          {me && !me.demo && (
            <>
              <div className="row">
                <div>
                  <div style={{ fontWeight: 500, fontSize: '13.5px' }}>{t('set.close')}</div>
                  <small>{t('set.closeSub')}</small>
                </div>
                <button className="btn ghost" type="button" aria-expanded={!!cl} onClick={openClose}>{cl ? t('common.cancel') : t('common.close')}</button>
              </div>
              {cl && (
                <form onSubmit={submitClose} noValidate style={{ paddingBottom: '8px' }}>
                  {cl.blocked ? (
                    <div className="ferr" role="alert">{cl.blocked}</div>
                  ) : (
                    <>
                      <small style={{ display: 'block', marginBottom: '8px' }}>
                        {t('set.closeWarn')}
                      </small>
                      {cl.miners > 0 && (
                        <>
                          <label style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: '13px', margin: '8px 0' }}>
                            <input type="checkbox" checked={clForfeit} onChange={(e) => { setClForfeit(e.target.checked); if (clErr.forfeit) setClErr({ ...clErr, forfeit: undefined }); }} style={{ marginTop: '3px' }} />
                            <span>{t(cl.miners === 1 ? 'set.forfeit1' : 'set.forfeitN', { n: cl.miners })}</span>
                          </label>
                          {clErr.forfeit && <div className="ferr" role="alert">{clErr.forfeit}</div>}
                        </>
                      )}
                      {cl.password && (
                        <Field id="cp" label={t('auth.password')} error={clErr.password}>
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
                        <Field id="ck" label={t('set.code')} error={clErr.code}>
                          <input
                            id="ck"
                            className={clErr.code ? 'bad' : undefined}
                            aria-invalid={!!clErr.code}
                            aria-describedby={clErr.code ? 'ck-err' : undefined}
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            autoCapitalize="none"
                            placeholder={t('auth.codePlaceholder')}
                            value={clCode}
                            onChange={(e) => {
                              setClCode(e.target.value);
                              if (clErr.code) setClErr({ ...clErr, code: undefined });
                            }}
                          />
                        </Field>
                      )}
                      <Field id="cd" label={t('set.delLabel')} error={clErr.confirm}>
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
                      <button className="btn" type="submit" disabled={clBusy} style={{ marginTop: '10px' }}>{clBusy ? t('set.closing') : t('set.closeMine')}</button>
                    </>
                  )}
                </form>
              )}
            </>
          )}
        </div>
      </div>
      {toast}
    </>
  );
}
