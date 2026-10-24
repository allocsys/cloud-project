'use client';
import { useEffect, useRef, useState } from 'react';
import { useApi, post, revalidate } from '@/lib/api';
import { triggerHaptic } from '@/lib/haptics';

// Boost tickets on the Plans page: a ticket starts a 2 hour boost of extra hashrate with a prize draw. Rules in lib/boost.js, server in
// lib/server/boost.js. Every purchase is its own boost, drawn as a wedge in a 20 slot dial (the fill grows outward as it runs). The draw shows when the boost ends.
// A ticket is paid from the balance, so the first tap only arms the button and the second one buys.

const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const usd = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const whole = (n) => n.toLocaleString('en-US');

function left(ms) {
  const m = Math.ceil(ms / 60000);
  if (m <= 1) return 'Under 1m';
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

// Wedge dial: 20 fixed slots of 18 degrees, inner radius R1, outer R2. Colour and rim thickness show the tier.
const SLOTS = 20;
const R1 = 46;
const R2 = 138;
const tier = (price) => (price >= 100 ? { c: '#AFA9EC', w: 5 } : price >= 10 ? { c: '#5DCAA5', w: 4 } : { c: '#EF9F27', w: 3 });
const pt = (r, d) => {
  const a = ((d - 90) * Math.PI) / 180;
  return [150 + r * Math.cos(a), 150 + r * Math.sin(a)];
};
const xy = (p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
const wedge = (r1, r2, a1, a2) => `M${xy(pt(r2, a1))}A${r2} ${r2} 0 0 1 ${xy(pt(r2, a2))}L${xy(pt(r1, a2))}A${r1} ${r1} 0 0 0 ${xy(pt(r1, a1))}Z`;
const rim = (r, a1, a2) => `M${xy(pt(r, a1))}A${r} ${r} 0 0 1 ${xy(pt(r, a2))}`;

export default function BoostCard({ show }) {
  const { data, refresh } = useApi('/api/boost', { ttl: 10000 });
  const [now, setNow] = useState(() => Date.now());
  const [arm, setArm] = useState(null); // the ticket waiting for its second tap
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState(null); // id of the boost picked on the dial
  const slotMap = useRef(new Map()); // boost id -> slot, so a wedge never moves when another boost ends
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

  const map = slotMap.current;
  const live = new Set(running.map((b) => b.id));
  for (const id of [...map.keys()]) if (!live.has(id)) map.delete(id);
  const used = new Set(map.values());
  [...running]
    .sort((a, b) => a.startAt - b.startAt)
    .forEach((b) => {
      if (map.has(b.id)) return;
      for (let i = 0; i < SLOTS; i++) {
        if (!used.has(i)) {
          map.set(b.id, i);
          used.add(i);
          break;
        }
      }
    });
  const slots = Array.from({ length: SLOTS }, () => null);
  running.forEach((b) => {
    const i = map.get(b.id);
    if (i !== undefined) slots[i] = b;
  });
  const next = running.reduce((a, b) => (!a || b.endsAt < a.endsAt ? b : a), null);
  const picked = running.find((b) => b.id === focus) || null;
  const nextIn = next ? left(next.endsAt - now) : '';

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
      {running.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <style>{'@keyframes boostPulse{0%,100%{opacity:.25}50%{opacity:1}}.boost-pulse{animation:boostPulse 2s ease-in-out infinite}@media (prefers-reduced-motion:reduce){.boost-pulse{animation:none}}'}</style>
          <svg viewBox="0 0 300 300" role="img" aria-label={`${running.length} boosts running`} style={{ display: 'block', width: 300, maxWidth: '100%', margin: '0 auto' }} onClick={() => setFocus(null)}>
            {slots.map((b, i) => {
              const a1 = i * 18 + 1;
              const a2 = i * 18 + 17;
              if (!b) return <path key={`e${i}`} d={wedge(R1, R2, a1, a2)} fill="none" stroke="var(--border-strong)" strokeWidth="0.5" strokeDasharray="3 3" />;
              const p = Math.max(0, Math.min(1, (now - b.startAt) / (b.endsAt - b.startAt)));
              const t = tier(b.price);
              const on = focus === b.id;
              return (
                <g
                  key={b.id}
                  style={{ cursor: 'pointer', opacity: focus !== null && !on && picked ? 0.25 : 1, transition: 'opacity .25s' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setFocus(on ? null : b.id);
                  }}
                >
                  <path d={wedge(R1, R2, a1, a2)} fill="currentColor" fillOpacity="0.06" stroke={on ? 'currentColor' : 'var(--border-strong)'} strokeWidth={on ? 1.5 : 0.5} />
                  {p > 0 && <path d={wedge(R1, R1 + (R2 - R1) * p, a1, a2)} fill={t.c} />}
                  <path d={rim(R2 + 6, a1 + 1, a2 - 1)} fill="none" stroke={t.c} strokeWidth={t.w} strokeLinecap="round" className={next && b.id === next.id && !picked ? 'boost-pulse' : undefined} />
                </g>
              );
            })}
            <circle cx="150" cy="150" r={R1 + (R2 - R1) / 2} fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="0.6" strokeDasharray="2 4" style={{ pointerEvents: 'none' }} />
            <text x="150" y={picked ? 154 : 152} textAnchor="middle" fontSize={picked ? 20 : 26} fontWeight="500" fill="currentColor" style={{ pointerEvents: 'none' }}>
              {picked ? left(picked.endsAt - now) : running.length}
            </text>
            <text x="150" y="170" textAnchor="middle" fontSize="11" fill="currentColor" fillOpacity="0.65" style={{ pointerEvents: 'none' }}>
              {picked ? `$${whole(picked.price)} boost` : 'running'}
            </text>
          </svg>
          <p className="mute" style={{ textAlign: 'center', fontSize: '13px', margin: '4px 0 0' }}>Next ends in {nextIn === 'Under 1m' ? 'under 1m' : nextIn}</p>
        </div>
      )}
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
