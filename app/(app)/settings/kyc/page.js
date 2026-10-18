'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Field from '@/components/Field';
import { drillBack, markDrill, unwind } from '@/lib/nav';
import { triggerHaptic } from '@/lib/haptics';
import { useApi, post, revalidate } from '@/lib/api';
import { COUNTRIES, DOCS, MAX_PHOTO, ageOf } from '@/lib/kyc';

const STEPS = ['Details', 'Document', 'Selfie', 'Review'];

const chev = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M15 5l-7 7 7 7" />
  </svg>
);

// Photo picker tile. Opens the camera or gallery; shows a thumbnail once chosen.
function Upload({ title, hint, file, onPick, capture }) {
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
        <small>{file ? 'Tap to replace' : hint}</small>
      </span>
    </label>
  );
}

export default function Kyc() {
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
      if (name.trim().split(/\s+/).length < 2) e.kn = 'Enter your first and last name.';
      if (!dob) e.kb = 'Enter your date of birth.';
      else if (ageOf(dob) < 18) e.kb = 'You must be 18 or older.';
      if (!country) e.kc = 'Choose your country.';
    }
    if (step === 1 && !front) e.front = 'Add a photo of your document.';
    else if (step === 1 && front.size > MAX_PHOTO) e.front = 'Photo is too large (max 12 MB).';
    if (step === 2 && !selfie) e.selfie = 'Add a selfie to continue.';
    else if (step === 2 && selfie.size > MAX_PHOTO) e.selfie = 'Photo is too large (max 12 MB).';
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
            aria-label="Back to settings"
            onClick={(e) => {
              e.preventDefault();
              if (step > 0 && status === 'none') window.history.back();
              else drillBack(router, '/settings');
            }}
          >
            {chev}
          </Link>
          <h2>Verify identity</h2>
        </div>
      </div>

      {status !== 'none' ? (
        <div className="card">
          <h3>{status === 'verified' ? 'Verified' : 'Submitted'}</h3>
          <p className="mute" style={{ margin: '8px 0 16px' }}>
            {status === 'verified'
              ? 'Your identity is verified.'
              : 'Your details are in review. We will let you know as soon as they are checked.'}
          </p>
          <button className="btn" type="button" onClick={() => drillBack(router, '/settings')}>Back to settings</button>
        </div>
      ) : (
        <div className="card">
          <div className="steps" role="progressbar" aria-valuemin={1} aria-valuemax={4} aria-valuenow={step + 1} aria-label="Verification progress">
            {STEPS.map((s, i) => (
              <i key={s} className={i <= step ? 'on' : undefined} />
            ))}
          </div>
          <span className="mute eyebrow">Step {step + 1} of 4 · {STEPS[step]}</span>

          {step === 0 && (
            <>
              <Field id="kn" label="Full name" error={errors.kn}>
                <input
                  id="kn"
                  autoComplete="name"
                  placeholder="As shown on your document"
                  className={cls('kn')}
                  {...err('kn')}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (errors.kn) setErrors({ ...errors, kn: undefined });
                  }}
                />
              </Field>
              <Field id="kb" label="Date of birth" error={errors.kb}>
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
              <Field id="kc" label="Country" error={errors.kc}>
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
                  <option value="" disabled>Select country</option>
                  {COUNTRIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </Field>
            </>
          )}

          {step === 1 && (
            <>
              <div className="tabs" role="group" aria-label="Document type" style={{ marginTop: 16 }}>
                {DOCS.map((d) => (
                  <button key={d} type="button" aria-pressed={doc === d} onClick={() => setDoc(d)}>{d}</button>
                ))}
              </div>
              <Upload
                title={`Photo of your ${doc.toLowerCase()}`}
                hint="Clear, all four corners visible"
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
              <p className="mute" style={{ margin: '12px 0 0' }}>Take a selfie in good light, face centred, no hat or sunglasses.</p>
              <Upload
                title="Take a selfie"
                hint="Opens your front camera"
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
              <div className="row" style={{ borderTop: 0 }}><span className="mute">Name</span><b className="v">{name.trim()}</b></div>
              <div className="row"><span className="mute">Date of birth</span><b className="v">{dob}</b></div>
              <div className="row"><span className="mute">Country</span><b className="v">{country}</b></div>
              <div className="row"><span className="mute">Document</span><b className="v">{doc}</b></div>
              <div className="row"><span className="mute">Selfie</span><b className="v">Added</b></div>
            </div>
          )}

          {fail && <div className="ferr" role="alert">{fail}</div>}
          <div style={{ height: 16 }} />
          <button className="btn" type="button" onClick={next} disabled={busy}>
            {step === 3 ? (busy ? 'Submitting…' : 'Submit for review') : 'Continue'}
          </button>
          {step > 0 && <button className="swap" type="button" onClick={prev} disabled={busy}>Back</button>}
        </div>
      )}
    </>
  );
}
