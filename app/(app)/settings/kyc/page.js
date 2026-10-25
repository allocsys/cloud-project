'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Field from '@/components/Field';
import { drillBack, markDrill, unwind } from '@/lib/nav';
import { triggerHaptic } from '@/lib/haptics';
import { useApi, post, revalidate } from '@/lib/api';
import { COUNTRIES, DOCS, MAX_PHOTO, ageOf } from '@/lib/kyc';
import { useT } from '@/components/I18nProvider';

const STEPS = ['kyc.s1', 'kyc.s2', 'kyc.s3', 'kyc.s4'];

const chev = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M15 5l-7 7 7 7" />
  </svg>
);

// Photo picker tile. Opens the camera or gallery; shows a thumbnail once chosen.
function Upload({ title, hint, file, onPick, capture }) {
  const t = useT();
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!file) {
      setUrl('');
      return undefined;
    }
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return (
    <label className={`upload${file ? ' has' : ''}`}>
      <input
        type="file"
        accept="image/*"
        capture={capture}
        onChange={(e) => onPick(e.target.files && e.target.files[0] ? e.target.files[0] : null)}
      />
      <span className="thumb" style={url ? { backgroundImage: `url(${url})` } : undefined} aria-hidden="true" />
      <span>
        <b>{file ? file.name : title}</b>
        <small>{file ? t('kyc.replace') : hint}</small>
      </span>
    </label>
  );
}

export default function Kyc() {
  const t = useT();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [country, setCountry] = useState('');
  const [doc, setDoc] = useState(DOCS[0]);
  const [front, setFront] = useState(null);
  const [selfie, setSelfie] = useState(null);
  const [errors, setErrors] = useState({});
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState('');
  const key = useRef('');
  const { data: kd, mutate } = useApi('/api/kyc', { ttl: 30000 });
  // Already submitted (or verified) from an earlier visit: show the result instead of the form.
  const status = done ? 'pending' : kd ? kd.status : 'none';
  // The card keeps its place but stays hidden until the saved status is in (or 1.5 seconds), so the form never flashes before the submitted or verified card.
  const [wait, setWait] = useState(true);
  useEffect(() => {
    const tm = setTimeout(() => setWait(false), 1500);
    return () => clearTimeout(tm);
  }, []);
  const hide = kd || done || !wait ? undefined : { visibility: 'hidden' };

  // Each step after the first owns a history entry, so the system back button steps back.
  const pushed = useRef(0);
  const finishing = useRef(false);
  useEffect(() => {
    const onPop = () => {
      if (finishing.current) {
        finishing.current = false;
        return;
      }
      pushed.current = Math.max(0, pushed.current - 1);
      setErrors({});
      setStep((s) => Math.max(0, s - 1));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [step, done]);

  const cls = (k) => (errors[k] ? 'bad' : undefined);
  const err = (k) => ({ 'aria-invalid': !!errors[k], 'aria-describedby': errors[k] ? `${k}-err` : undefined });

  function validate() {
    const e = {};
    if (step === 0) {
      if (name.trim().split(/\s+/).length < 2) e.kn = t('kyc.eName');
      if (!dob) e.kb = t('kyc.eDob');
      else if (ageOf(dob) < 18) e.kb = t('kyc.eAge');
      if (!country) e.kc = t('kyc.eCountry');
    }
    if (step === 1 && !front) e.front = t('kyc.eFront');
    else if (step === 1 && front.size > MAX_PHOTO) e.front = t('kyc.eBig');
    if (step === 2 && !selfie) e.selfie = t('kyc.eSelfie');
    else if (step === 2 && selfie.size > MAX_PHOTO) e.selfie = t('kyc.eBig');
    return e;
  }

  async function submit() {
    if (busy) return;
    setBusy(true);
    setFail('');
    const fd = new FormData();
    fd.append('name', name.trim());
    fd.append('dob', dob);
    fd.append('country', country);
    fd.append('doc', doc);
    fd.append('front', front);
    fd.append('selfie', selfie);
    key.current ||= `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      await post('/api/kyc', fd, key.current);
    } catch (e) {
      triggerHaptic('error');
      setFail(e.message);
      setBusy(false);
      return;
    }
    mutate({ status: 'pending', submittedAt: Date.now() });
    revalidate('/api/notifications').catch(() => {});
    triggerHaptic('success');
    // Drop the step entries so back from the confirmation leaves the flow.
    if (pushed.current > 0) {
      const n = pushed.current;
      pushed.current = 0;
      finishing.current = true;
      unwind(n);
    }
    setBusy(false);
    setDone(true);
  }

  function next() {
    const e = validate();
    if (Object.keys(e).length) {
      triggerHaptic('error');
      setErrors(e);
      return;
    }
    triggerHaptic('light');
    setErrors({});
    if (busy) return;
    if (step < 3) {
      window.history.pushState({ opusStep: true }, '');
      markDrill();
      pushed.current += 1;
      setStep(step + 1);
    } else submit();
  }

  function prev() {
    triggerHaptic('selection');
    window.history.back();
  }

  return (
    <>
      <div className="top">
        <div className="tl">
          <Link
            href="/settings"
            className="back"
            aria-label={t('kyc.backSettings')}
            onClick={(e) => {
              e.preventDefault();
              if (step > 0 && status === 'none') window.history.back();
              else drillBack(router, '/settings');
            }}
          >
            {chev}
          </Link>
          <h2>{t('kyc.title')}</h2>
        </div>
      </div>

      {status !== 'none' ? (
        <div className="card" style={hide}>
          <h3>{status === 'verified' ? t('kyc.verified') : t('kyc.submitted')}</h3>
          <p className="mute" style={{ margin: '8px 0 16px' }}>
            {status === 'verified'
              ? t('kyc.verifiedLine')
              : t('kyc.reviewLine')}
          </p>
          <button className="btn" type="button" onClick={() => drillBack(router, '/settings')}>{t('kyc.backSettings')}</button>
        </div>
      ) : (
        <div className="card" style={hide}>
          <div className="steps" role="progressbar" aria-valuemin={1} aria-valuemax={4} aria-valuenow={step + 1} aria-label={t('kyc.progress')}>
            {STEPS.map((s, i) => (
              <i key={s} className={i <= step ? 'on' : undefined} />
            ))}
          </div>
          <span className="mute eyebrow">{t('kyc.step', { n: step + 1, s: t(STEPS[step]) })}</span>

          {step === 0 && (
            <>
              <Field id="kn" label={t('kyc.fullName')} error={errors.kn}>
                <input
                  id="kn"
                  autoComplete="name"
                  placeholder={t('kyc.asShown')}
                  className={cls('kn')}
                  {...err('kn')}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (errors.kn) setErrors({ ...errors, kn: undefined });
                  }}
                />
              </Field>
              <Field id="kb" label={t('kyc.dob')} error={errors.kb}>
                <input
                  id="kb"
                  type="date"
                  autoComplete="bday"
                  max={new Date().toISOString().slice(0, 10)}
                  className={cls('kb')}
                  {...err('kb')}
                  value={dob}
                  onChange={(e) => {
                    setDob(e.target.value);
                    if (errors.kb) setErrors({ ...errors, kb: undefined });
                  }}
                />
              </Field>
              <Field id="kc" label={t('kyc.country')} error={errors.kc}>
                <select
                  id="kc"
                  autoComplete="country-name"
                  className={cls('kc')}
                  {...err('kc')}
                  value={country}
                  onChange={(e) => {
                    setCountry(e.target.value);
                    if (errors.kc) setErrors({ ...errors, kc: undefined });
                  }}
                >
                  <option value="" disabled>{t('kyc.selectCountry')}</option>
                  {COUNTRIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </Field>
            </>
          )}

          {step === 1 && (
            <>
              <div className="tabs" role="group" aria-label={t('kyc.docType')} style={{ marginTop: 16 }}>
                {DOCS.map((d) => (
                  <button key={d} type="button" aria-pressed={doc === d} onClick={() => setDoc(d)}>{d}</button>
                ))}
              </div>
              <Upload
                title={t('kyc.photoOf', { doc: doc.toLowerCase() })}
                hint={t('kyc.clear')}
                file={front}
                onPick={(f) => {
                  setFront(f);
                  setErrors({});
                }}
              />
              {errors.front && <div className="ferr" role="alert">{errors.front}</div>}
            </>
          )}

          {step === 2 && (
            <>
              <p className="mute" style={{ margin: '12px 0 0' }}>{t('kyc.selfieTip')}</p>
              <Upload
                title={t('kyc.takeSelfie')}
                hint={t('kyc.frontCam')}
                capture="user"
                file={selfie}
                onPick={(f) => {
                  setSelfie(f);
                  setErrors({});
                }}
              />
              {errors.selfie && <div className="ferr" role="alert">{errors.selfie}</div>}
            </>
          )}

          {step === 3 && (
            <div style={{ marginTop: 8 }}>
              <div className="row" style={{ borderTop: 0 }}><span className="mute">{t('ref.name')}</span><b className="v">{name.trim()}</b></div>
              <div className="row"><span className="mute">{t('kyc.dob')}</span><b className="v">{dob}</b></div>
              <div className="row"><span className="mute">{t('kyc.country')}</span><b className="v">{country}</b></div>
              <div className="row"><span className="mute">{t('kyc.s2')}</span><b className="v">{doc}</b></div>
              <div className="row"><span className="mute">{t('kyc.s3')}</span><b className="v">{t('kyc.added')}</b></div>
            </div>
          )}

          {fail && <div className="ferr" role="alert">{fail}</div>}
          <div style={{ height: 16 }} />
          <button className="btn" type="button" onClick={next} disabled={busy}>
            {step === 3 ? (busy ? t('kyc.submitting') : t('kyc.submit')) : t('common.continue')}
          </button>
          {step > 0 && <button className="swap" type="button" onClick={prev} disabled={busy}>{t('kyc.back')}</button>}
        </div>
      )}
    </>
  );
}
