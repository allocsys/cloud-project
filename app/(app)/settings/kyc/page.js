'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Field from '@/components/Field';
import { drillBack } from '@/lib/nav';
import { triggerHaptic } from '@/lib/haptics';

const COUNTRIES = [
  'United States', 'United Kingdom', 'Canada', 'Germany', 'France', 'Spain', 'Italy',
  'Netherlands', 'Australia', 'United Arab Emirates', 'Other',
];
const DOCS = ['Passport', 'ID card', 'Licence'];
const STEPS = ['Details', 'Document', 'Selfie', 'Review'];

const chev = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M15 5l-7 7 7 7" />
  </svg>
);

function ageOf(s) {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return 0;
  const n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  const m = n.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && n.getDate() < d.getDate())) a -= 1;
  return a;
}

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
    if (step === 2 && !selfie) e.selfie = 'Add a selfie to continue.';
    return e;
  }

  // TODO: upload the details and both photos to your verification API here.
  function submit() {
    try {
      localStorage.setItem('opus-kyc', 'pending');
    } catch {}
    triggerHaptic('success');
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
    if (step < 3) setStep(step + 1);
    else submit();
  }

  function prev() {
    triggerHaptic('selection');
    setErrors({});
    setStep(step - 1);
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
              drillBack(router, '/settings');
            }}
          >
            {chev}
          </Link>
          <h2>Verify identity</h2>
        </div>
      </div>

      {done ? (
        <div className="card">
          <h3>Submitted</h3>
          <p className="mute" style={{ margin: '8px 0 16px' }}>
            Your details are in review. We will let you know as soon as they are checked.
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

          <div style={{ height: 16 }} />
          <button className="btn" type="button" onClick={next}>{step === 3 ? 'Submit for review' : 'Continue'}</button>
          {step > 0 && <button className="swap" type="button" onClick={prev}>Back</button>}
        </div>
      )}
    </>
  );
}
