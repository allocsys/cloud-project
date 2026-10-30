'use client';
// Rate us card at the bottom of the Earnings screen (see lib/rating.js). It sits last, so nothing moves when it appears.
import { useState } from 'react';
import { useApi, post } from '@/lib/api';
import { useT } from '@/components/I18nProvider';
import Field from '@/components/Field';

const STAR = 'M12 2.8l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.7 6.1 20.8l1.2-6.5L2.5 9.7l6.6-.9z';

export default function RateUs({ style }) {
  const t = useT();
  const { data, mutate } = useApi('/api/rate', { ttl: 60000 });
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState(false);
  if (!data || (!data.ask && !sent)) return null;

  const send = async () => {
    setBusy(true);
    setErr('');
    try {
      await post('/api/rate', { stars, comment });
      mutate({ ask: false, url: data.url });
      setSent(true);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const later = async () => {
    mutate({ ask: false, url: data.url });
    try {
      await post('/api/rate', { skip: true });
    } catch {}
  };

  if (sent) {
    return (
      <div className="card rate" style={style}>
        <h3>{t('rate.thanks')}</h3>
        {data.url && (
          <a className="btn ghost" href={data.url} target="_blank" rel="noopener noreferrer" style={{ marginTop: 12 }}>
            {t('rate.public')}
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="card rate" style={style}>
      <h3>{t('rate.title')}</h3>
      <small className="mute" style={{ fontSize: '12px' }}>{t('rate.sub')}</small>
      <div className="rate-stars" role="group" aria-label={t('rate.title')}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" className={n <= stars ? 'on' : ''} aria-pressed={n === stars} aria-label={t('rev.stars', { n })} onClick={() => setStars(n)}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d={STAR} />
            </svg>
          </button>
        ))}
      </div>
      {stars > 0 && (
        <>
          <Field id="rate-c" label={t('rate.comment')} error={err}>
            <input id="rate-c" placeholder=" " value={comment} maxLength={280} onChange={(e) => setComment(e.target.value)} />
          </Field>
          <div className="rate-act">
            <button type="button" className="btn ghost" disabled={busy} onClick={later}>{t('rate.later')}</button>
            <button type="button" className="btn" disabled={busy} onClick={send}>{t('rate.send')}</button>
          </div>
        </>
      )}
      {stars === 0 && (
        <button type="button" className="rate-skip" onClick={later}>{t('rate.later')}</button>
      )}
    </div>
  );
}
