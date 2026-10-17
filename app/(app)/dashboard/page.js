'use client';
import { useEffect, useState } from 'react';
import { useMinedFeed, useNow, formatBtc, formatUsd, BTC_USD } from '@/lib/useMined';
import { contracts, earnings, TODAY_BTC } from '@/lib/data';

const totalTh = contracts.reduce((s, c) => s + c.th, 0);

function ago(now, at) {
  if (!now) return 'now';
  const s = Math.max(0, Math.floor((now - at) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m`;
}

// Line chart you can scrub: hover, touch-drag or arrow keys show that day's value.
function ChartBox({ rows }) {
  const [idx, setIdx] = useState(null);
  const n = rows.length;
  const max = Math.max(...rows.map((d) => d.usd));
  const y = (usd) => 112 - (usd / max) * 96;
  const pts = rows.map((d, i) => [(i * 300) / (n - 1), y(d.usd)]);
  const line = pts.map(([x, py], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${py.toFixed(1)}`).join(' ');
  const last = n - 1;

  function pick(e) {
    const r = e.currentTarget.getBoundingClientRect();
    const f = (e.clientX - r.left) / r.width;
    setIdx(Math.min(last, Math.max(0, Math.round(f * last))));
  }

  function onKey(e) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const step = e.key === 'ArrowRight' ? 1 : -1;
      setIdx((i) => Math.min(last, Math.max(0, (i === null ? last : i) + step)));
    } else if (e.key === 'Escape') {
      setIdx(null);
    }
  }

  const a = idx === null ? null : rows[idx];
  const xPct = idx === null ? 0 : (idx / last) * 100;
  const yPct = a ? (y(a.usd) / 120) * 100 : 0;

  return (
    <div
      className="chartbox"
      tabIndex={0}
      role="group"
      aria-label="Daily earnings chart. Use left and right arrow keys to inspect each day."
      onPointerDown={pick}
      onPointerMove={pick}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setIdx(null)}
      onKeyDown={onKey}
      onBlur={() => setIdx(null)}
    >
      <svg className="spark" viewBox="0 0 300 120" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#d4a84b" stopOpacity=".4" />
            <stop offset="100%" stopColor="#d4a84b" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${line} L300 120 L0 120Z`} fill="url(#g)" />
        <path d={line} fill="none" stroke="#f1d48a" strokeWidth="2.2" vectorEffect="non-scaling-stroke" />
        {!a && <circle cx={pts[last][0]} cy={pts[last][1]} r="4.5" fill="#fff" stroke="#070605" strokeWidth="2" />}
      </svg>
      {a && (
        <>
          <div className="cur" style={{ left: `${xPct}%` }} />
          <div className="dot" style={{ left: `${xPct}%`, top: `${yPct}%` }} />
          <div className="tip" style={{ left: `clamp(56px, ${xPct}%, calc(100% - 56px))` }} aria-live="polite">
            {a.day}{a.partial ? ' (so far)' : ''} · ${formatUsd(a.usd)}
          </div>
        </>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { mined, shares } = useMinedFeed();
  const now = useNow(1000);
  const [range, setRange] = useState('week');
  const [pulse, setPulse] = useState(false);

  const rows = earnings[range];
  const labels =
    range === 'week' ? rows.map((d) => d.label) : [rows[0].day, rows[Math.floor(rows.length / 2)].day, 'Today'];
  const avg = rows.reduce((s, d) => s + d.usd, 0) / rows.length;
  const latest = shares[0];

  useEffect(() => {
    setPulse(true);
    const t = setTimeout(() => setPulse(false), 300);
    return () => clearTimeout(t);
  }, [mined]);

  return (
    <>
      <div className="top">
        <h2>Earnings</h2>
        <span className="pill"><i />Live</span>
      </div>
      <div className="grid">
        <div className="card hero">
          <span className="mute eyebrow">Total mined</span>
          <div className="big">
            <span style={{ transition: 'color 0.2s', color: pulse ? '#fff' : 'var(--gold2)' }}>{formatBtc(mined)}</span>
            <small>BTC</small>
          </div>
          <span className="mute" style={{ fontSize: '14px' }}>≈ ${formatUsd(mined * BTC_USD)}</span>
          <div className="chips">
            <span>{totalTh} TH/s</span>
            <span>Today +{formatBtc(TODAY_BTC, 5)}</span>
            <span>99.8% uptime</span>
            {latest && <span key={latest.id} className="live">+{latest.sats} sat · {ago(now, latest.at)}</span>}
          </div>
        </div>

        <div className="grid cols">
          <div className="card">
            <div className="cardhead">
              <div>
                <h3>Daily earnings</h3>
                <small className="mute" style={{ fontSize: '12px' }}>avg ${formatUsd(avg)}/day</small>
              </div>
              <div className="minitabs" role="group" aria-label="Chart range">
                <button aria-pressed={range === 'week'} onClick={() => setRange('week')}>7d</button>
                <button aria-pressed={range === 'all'} onClick={() => setRange('all')}>All</button>
              </div>
            </div>
            <div key={range}>
              <ChartBox rows={rows} />
              <div className="chartlabels">
                {labels.map((l, i) => (
                  <span key={l + i} className={i === labels.length - 1 ? 'now' : undefined}>{l}</span>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="cardhead">
              <h3>Contracts</h3>
              <span className="mute">{contracts.length} running</span>
            </div>
            {contracts.map((c) => {
              const pct = Math.round((c.elapsed / c.days) * 100);
              return (
                <div key={c.serial} className="mini">
                  <div className="t">{c.name}<span>Day {c.elapsed}/{c.days}</span></div>
                  <div className="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                    <i style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
