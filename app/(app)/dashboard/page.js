'use client';
import { useEffect, useState } from 'react';
import { useMinedFeed, useNow, formatBtc, formatUsd, BTC_USD } from '@/lib/useMined';
import { contracts, halls, earnings, TODAY_BTC, BLOCK_HEIGHT } from '@/lib/data';

const totalTh = contracts.reduce((s, c) => s + c.th, 0);
const sum = (rows) => rows.reduce((s, d) => s + d.usd, 0);

function ago(now, at) {
  if (!now) return 'just now';
  const s = Math.max(0, Math.floor((now - at) / 1000));
  return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`;
}

function Chart({ rows }) {
  const max = Math.max(...rows.map((d) => d.usd));
  const pts = rows.map((d, i) => [
    (i * 300) / (rows.length - 1),
    112 - (d.usd / max) * 96,
  ]);
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const last = pts.length - 1;
  const showDots = rows.length <= 8;

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
      {showDots &&
        pts.map(([x, y], i) => (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={i === last ? 4.5 : 2.5}
            fill={i === last ? '#fff' : '#f1d48a'}
            stroke="#070605"
            strokeWidth={i === last ? 2 : 1}
          />
        ))}
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
    range === 'week'
      ? rows.map((d) => d.label)
      : [rows[0].day, rows[Math.floor(rows.length / 2)].day, 'Today'];
  const total = sum(rows);
  const avg = total / rows.length;

  useEffect(() => {
    setPulse(true);
    const t = setTimeout(() => setPulse(false), 300);
    return () => clearTimeout(t);
  }, [mined]);

  const stats = [
    ['Hash power', `${totalTh} TH/s`],
    ['Today', `+${formatBtc(TODAY_BTC, 5)} BTC`, 'up'],
    ['Uptime', '99.8%'],
    ['Block', BLOCK_HEIGHT.toLocaleString('en-US')],
  ];

  return (
    <>
      <div className="top">
        <h2>Earnings</h2>
        <span className="pill"><i />Mining live</span>
      </div>
      <div className="grid">
        <div className="card hero">
          <span className="mute eyebrow">Total Mined (Live)</span>
          <div className="big">
            <span style={{ transition: 'color 0.2s', color: pulse ? '#fff' : 'var(--gold2)' }}>
              {formatBtc(mined)}
            </span>
            <small>BTC</small>
          </div>
          <span className="mute" style={{ fontSize: '14px' }}>
            ≈ ${formatUsd(mined * BTC_USD)} USD · BTC ${BTC_USD.toLocaleString('en-US')}
          </span>
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
          <div className="card chartwrap">
            <div>
              <div className="cardhead">
                <h3>Daily earnings</h3>
                <div className="minitabs" role="group" aria-label="Chart range">
                  <button aria-pressed={range === 'week'} onClick={() => setRange('week')}>7 days</button>
                  <button aria-pressed={range === 'all'} onClick={() => setRange('all')}>All time</button>
                </div>
              </div>
              <div className="chartsum">
                <span className="mute">Total<b>${formatUsd(total)}</b></span>
                <span className="mute">Daily avg<b>${formatUsd(avg)}</b></span>
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
              <h3>Active contracts</h3>
              <span className="mute">{contracts.length} running</span>
            </div>
            {contracts.map((c) => {
              const pct = Math.round((c.elapsed / c.days) * 100);
              return (
                <div key={c.serial} className="contract">
                  <div className="top2">
                    <div>
                      <b>{c.name}</b>
                      <small>{halls[c.hall].name} · ends {c.ends}</small>
                    </div>
                    <span className="serial">{c.serial}</span>
                  </div>
                  <div className="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                    <i style={{ width: `${pct}%` }} />
                  </div>
                  <div className="barmeta">
                    <span>Day {c.elapsed} of {c.days}</span>
                    <span>{c.days - c.elapsed} days left</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card">
          <div className="cardhead">
            <h3>Live shares</h3>
            <span className="pill" style={{ padding: '3px 10px', fontSize: '11px' }}><i />Streaming</span>
          </div>
          {shares.length === 0 && <div className="empty">Waiting for the next share…</div>}
          {shares.map((s) => (
            <div key={s.id} className="row shareitem">
              <div>
                <div style={{ fontWeight: 600 }}>Share accepted</div>
                <small>{ago(now, s.at)}</small>
              </div>
              <b>+{s.sats} sat{s.sats > 1 ? 's' : ''}</b>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
