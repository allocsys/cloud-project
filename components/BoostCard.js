'use client';
import { useEffect, useRef, useState } from 'react';
import { useApi, post, revalidate } from '@/lib/api';
import { triggerHaptic } from '@/lib/haptics';

// Boost tickets on the Plans page: a ticket starts a 2 hour boost of extra hashrate with a prize draw. Rules in lib/boost.js, server in
// lib/server/boost.js. Every purchase is its own boost with its own progress bar (oldest first). The draw shows when the boost ends.
// A ticket is paid from the balance, so the first tap only arms the button and the second one buys.

const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const usd = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const whole = (n) => n.toLocaleString('en-US');

function left(ms) {
  const m = Math.ceil(ms / 60000);
  if (m <= 1) return 'Under 1m';
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

export default function BoostCard({ show }) {
  const { data, refresh } = useApi('/api/boost', { ttl: 10000 });
  const [now, setNow] = useState(() => Date.now());
  const [arm, setArm] = useState(null); // the ticket waiting for its second tap
  const [busy, setBusy] = useState(false);
  const skew = useRef(0); // server clock minus this device's clock
  const key = useRef(null);
  const armTimer = useRef(null);

  useEffect(() => {
    if (data?.now) skew.current = data.now - Date.now();
  }, [data]);

  // Ticks every few seconds so the bars and the time left move; when a boost has ended, ask the server for its result.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + skew.current), 5000);
    return () => clearInterval(t);
  }, []);
  const running = data?.running || [];
  const ended = running.some((b) => now >= b.endsAt);
  useEffect(() => {
    if (!ended) return;
    refresh().catch(() => {});
    revalidate('/api/wallet').catch(() => {});
  }, [ended]);
  useEffect(() => () => clearTimeout(armTimer.current), []);

  if (!data || (!data.enabled && !running.length)) return null;

  async function tap(t) {
    if (busy) return;
    if (arm !== t.id) {
      triggerHaptic('selection');
      key.current = uid();
      setArm(t.id);
      clearTimeout(armTimer.current);
      armTimer.current = setTimeout(() => setArm(null), 4000);
      return;
    }
    clearTimeout(armTimer.current);
    setArm(null);
    setBusy(true);
    try {
      await post('/api/boost', { ticket: t.id }, key.current);
      await refresh().catch(() => {});
      triggerHaptic('success');
      show('Boost started');
    } catch (e) {
      triggerHaptic('error');
      show(e.status ? e.message : 'No connection. Try again.');
    } finally {
      setBusy(false);
      revalidate('/api/wallet').catch(() => {});
    }
  }

  const finished = (data.finished || []).slice(0, 3);
  return (
    <div className="card">
      <h3>Boost</h3>
      <p className="mute" style={{ fontSize: '13px', margin: '4px 0 0' }}>{data.hours} hours of extra hashrate. Pays when it ends.</p>
      {data.enabled &&
        data.tickets.map((t) => (
          <div className="row" key={t.id}>
            <div>
              <b>${whole(t.price)}</b> · {whole(t.th)} TH/s
              <small style={{ display: 'block' }}>pays ${usd(t.pay)} · {t.chance}% chance to win ${whole(t.prize)}</small>
            </div>
            <button type="button" className={arm === t.id ? 'btn' : 'swap'} style={{ width: 'auto', margin: 0, padding: '0 14px', minHeight: 36 }} disabled={busy || t.active >= t.max} onClick={() => tap(t)}>
              {t.active >= t.max ? 'Full' : arm === t.id ? `Pay $${whole(t.price)}` : 'Buy'}
            </button>
          </div>
        ))}
      {running.map((b) => {
        const pct = Math.max(0, Math.min(100, Math.round(((now - b.startAt) / (b.endsAt - b.startAt)) * 100)));
        return (
          <div key={b.id} style={{ marginTop: 14 }}>
            <div className="cmeta" style={{ marginBottom: 6 }}>
              <span>${whole(b.price)} boost · {whole(b.th)} TH/s</span>
              <span>Ends in {left(b.endsAt - now)}</span>
            </div>
            <div className="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <i style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
      {finished.map((b) => (
        <div className="row" key={b.id}>
          <span className="mute">${whole(b.price)} boost</span>
          {b.win ? <b style={{ color: 'var(--green)' }}>You won ${whole(b.prize)}</b> : <b className="v">No prize this time. ${usd(b.pay)} added.</b>}
        </div>
      ))}
      <p className="fine" style={{ margin: '12px 0 0' }}>Each ticket has its own draw. The result shows when the boost ends. Paid from your balance.</p>
    </div>
  );
}
