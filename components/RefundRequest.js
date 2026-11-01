'use client';
import { useState } from 'react';
import { useApi, post } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { triggerHaptic } from '@/lib/haptics';
import { useT } from '@/components/I18nProvider';
import { REASONS, AGAIN, NOTE_MAX } from '@/lib/refund-rules';

// "Request a refund" on a miner's page. It shows only while a refund can still be asked for (the server says so in `open`),
// while a request is waiting, or after one was declined. The questions are fixed (lib/refund-rules.js): why, would you buy
// again, and a free note that is required when the reason is Other.
export default function RefundRequest({ serial }) {
  const t = useT();
  const { data, refresh } = useApi('/api/refunds', { ttl: 15000 });
  const [toast, show] = useToast();
  const [sheet, setSheet] = useState(false);
  const [reason, setReason] = useState('');
  const [again, setAgain] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (!data) return null;
  const mine = (data.requests || []).filter((r) => r.serial === serial);
  const pending = mine.find((r) => r.status === 'pending');
  const last = mine[0];
  const canAsk = !pending && !!data.open?.[serial];
  if (!pending && !canAsk && last?.status !== 'rejected') return null;

  const needNote = reason === 'other' && note.trim().length < 3;

  function openSheet() {
    triggerHaptic('selection');
    setErr('');
    setSheet(true);
  }

  async function send() {
    if (busy || !reason || needNote) return;
    setBusy(true);
    setErr('');
    try {
      await post('/api/refunds', { serial, reason, again, note });
      setSheet(false);
      setReason('');
      setAgain('');
      setNote('');
      show(t('rr.sent'));
      await refresh();
    } catch (e) {
      triggerHaptic('error');
      setErr(e.message);
      if (e.status === 409) refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="card">
        <div className="cardhead">
          <h3>{t('rr.title')}</h3>
        </div>
        {pending && <div className="row"><span className="mute">{t('rr.pending')}</span></div>}
        {!pending && last?.status === 'rejected' && (
          <div className="row">
            <div>
              <b>{t('rr.declined')}</b>
              {last.answer && <small>{last.answer}</small>}
            </div>
          </div>
        )}
        {canAsk && (
          <button type="button" className="btn ghost" style={{ marginTop: 8 }} onClick={openSheet}>{t('rr.btn')}</button>
        )}
      </div>

      {sheet && (
        <div
          className="sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rr-h"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setSheet(false);
          }}
        >
          <div className="card">
            <div className="grab" aria-hidden="true" />
            <h3 id="rr-h">{t('rr.title')}</h3>
            <div className="sheetbody">
              <p className="mute" style={{ margin: '0 0 10px' }}>{t('rr.intro')}</p>

              <fieldset style={{ border: 0, padding: 0, margin: '0 0 12px' }}>
                <legend style={{ fontWeight: 500, marginBottom: 4 }}>{t('rr.why')}</legend>
                {REASONS.map((r) => (
                  <label key={r} className="row" style={{ cursor: 'pointer' }}>
                    <span>{t(`rr.r.${r}`)}</span>
                    <input type="radio" name="rr-why" checked={reason === r} onChange={() => { triggerHaptic('selection'); setReason(r); }} />
                  </label>
                ))}
              </fieldset>

              <div style={{ margin: '0 0 12px' }}>
                <div style={{ fontWeight: 500, marginBottom: 6 }}>{t('rr.again')}</div>
                <div className="terms" role="group" aria-label={t('rr.again')}>
                  {AGAIN.map((a) => (
                    <button key={a} type="button" aria-pressed={again === a} onClick={() => { triggerHaptic('selection'); setAgain(again === a ? '' : a); }}>{t(`rr.a.${a}`)}</button>
                  ))}
                </div>
              </div>

              <label htmlFor="rr-note" style={{ display: 'block', fontWeight: 500, marginBottom: 6 }}>{t('rr.note')}</label>
              <textarea
                id="rr-note"
                rows={3}
                maxLength={NOTE_MAX}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 12, border: '1px solid var(--line)', background: 'transparent', color: 'inherit', font: 'inherit', resize: 'vertical' }}
              />
              {err && <div className="ferr" role="alert">{err}</div>}
            </div>
            <button className="btn" type="button" disabled={busy || !reason || needNote} onClick={send}>{t('rr.send')}</button>
            <button className="btn ghost" type="button" disabled={busy} style={{ marginTop: 8 }} onClick={() => setSheet(false)}>{t('common.cancel')}</button>
          </div>
        </div>
      )}
      {toast}
    </>
  );
}
