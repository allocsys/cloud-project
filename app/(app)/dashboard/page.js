'use client';
import { useEffect, useState } from 'react';
import { useMined, BTC_USD } from '@/lib/useMined';
import { contracts } from '@/lib/data';

const stats = [
  ['Hash power', '120 TH/s'],
  ['Today', '+0.00006 BTC', 'up'],
  ['Uptime', '99.8%'],
  ['Power cost', '$0.06/TH'],
];

const chartDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Today'];

const points = [
  [0, 90],
  [50, 70],
  [100, 80],
  [150, 50],
  [200, 58],
  [250, 30],
  [300, 38],
];

export default function Dashboard() {
  const mined = useMined();
  const [pulse, setPulse] = useState(false);
  const usd = (mined * BTC_USD).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(' ');

  useEffect(() => {
    setPulse(true);
    const t = setTimeout(() => setPulse(false), 300);
    return () => clearTimeout(t);
  }, [mined]);

  return (
    <>
      <div className="top">
        <h2>Earnings</h2>
        <span className="pill"><i />Mining live</span>
      </div>
      <div className="grid">
        <div className="card hero">
          <span className="mute" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: '11.5px', fontWeight: 600 }}>
            Total Mined (Live)
          </span>
          <div className="big">
            <span style={{ transition: 'color 0.2s', color: pulse ? '#fff' : 'var(--gold2)' }}>
              {mined.toFixed(8)}
            </span>
            <small>BTC</small>
          </div>
          <span className="mute" style={{ fontSize: '14px' }}>≈ ${usd} USD</span>
        </div>

        <div className="stats">
          {stats.map(([k, v, c]) => (
            <div key={k} className="card stat">
              <span className="mute">{k}</span>
              <b className={c}>{v}</b>
            </div>
          ))}
        </div>

        <div className="grid cols">
          <div className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>Last 7 days</h3>
              <span className="up" style={{ fontSize: '12px', fontWeight: 600 }}>+18.4% this week</span>
            </div>
            <div>
              <svg className="spark" viewBox="0 0 300 120" preserveAspectRatio="none" aria-label="Daily earnings chart">
                <defs>
                  <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#d4a84b" stopOpacity=".4" />
                    <stop offset="100%" stopColor="#d4a84b" stopOpacity="0" />
                  </linearGradient>
                  <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="3" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
                <path d={`${line} L300 120 L0 120Z`} fill="url(#g)" />
                <path d={line} fill="none" stroke="#f1d48a" strokeWidth="2.2" vectorEffect="non-scaling-stroke" filter="url(#glow)" />
                {points.map(([x, y], i) => (
                  <circle
                    key={i}
                    cx={x}
                    cy={y}
                    r={i === points.length - 1 ? 4.5 : 2.5}
                    fill={i === points.length - 1 ? '#fff' : '#f1d48a'}
                    stroke="#070605"
                    strokeWidth={i === points.length - 1 ? 2 : 1}
                  />
                ))}
              </svg>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px', padding: '0 2px' }}>
                {chartDays.map((d, i) => (
                  <span key={d} style={{ fontSize: '11px', color: i === chartDays.length - 1 ? 'var(--gold2)' : 'var(--mute)', fontWeight: i === chartDays.length - 1 ? 700 : 400 }}>
                    {d}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <h3>Active contracts</h3>
              <span className="mute" style={{ fontSize: '12px' }}>{contracts.length} running</span>
            </div>
            {contracts.map((c) => (
              <div key={c.name} className="row">
                <div>
                  <div style={{ fontWeight: 600 }}>{c.name}</div>
                  <small>Ends {c.ends}</small>
                </div>
                <span className="pill" style={{ padding: '3px 8px', fontSize: '11px' }}>
                  <i />Active
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
