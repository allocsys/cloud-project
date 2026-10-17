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

function Chart({ rows }) {
  const max = Math.max(...rows.map((d) => d.usd));
  const pts = rows.map((d, i) => [(i * 300) / (rows.length - 1), 112 - (d.usd / max) * 96]);
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const last = pts.length - 1;

  return (
    <svg className="spark" viewBox="0 0 300 120" preserveAspectRatio="none" role="img" aria-label="Daily earnings chart">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d4a84b" stopOpacity=".4" />
          <stop offset="100%" stopColor="#d4a84b" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L300 120 L0 120Z`} fill="url(#g)" />
      <path d={line} fill="none" stroke="#f1d48a" strokeWidth="2.2" vectorEffect="non-scaling-stroke" />
      <circle cx={pts[last][0]} cy={pts[last][1]} r="4.5" fill="#fff" stroke="#070605" strokeWidth="2" />
    </svg>
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
              <Chart rows={rows} />
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
