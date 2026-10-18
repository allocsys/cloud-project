'use client';
import { useEffect, useState } from 'react';
import Spark from '@/components/Spark';
import { useMinedFeed, useNow, formatBtc, formatUsd, BTC_USD } from '@/lib/useMined';
import { useCountUp } from '@/lib/useCountUp';
import { contracts, earnings, stats, TODAY_BTC } from '@/lib/data';

const totalTh = contracts.reduce((s, c) => s + c.th, 0);

function ago(now, at) {
  if (!now) return 'now';
  const s = Math.max(0, Math.floor((now - at) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m`;
}

// Time left until the next daily payout (00:00 UTC) and how much of the day has passed.
function payoutIn(now) {
  if (!now) return { text: '--:--:--', pct: 0 };
  const d = new Date(now);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  const left = Math.max(0, Math.floor((next - now) / 1000));
  const p = (n) => String(n).padStart(2, '0');
  return {
    text: `${p(Math.floor(left / 3600))}:${p(Math.floor((left % 3600) / 60))}:${p(left % 60)}`,
    pct: 100 - (left / 86400) * 100,
  };
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
  const shown = useCountUp(mined);
  const now = useNow(1000);
  const [range, setRange] = useState('week');
  const [pulse, setPulse] = useState(false);

  const rows = earnings[range];
  const labels =
    range === 'week' ? rows.map((d) => d.label) : [rows[0].day, rows[Math.floor(rows.length / 2)].day, 'Today'];
  const avg = rows.reduce((s, d) => s + d.usd, 0) / rows.length;
  const latest = shares[0];
  const pay = payoutIn(now);

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
            <span style={{ transition: 'color 0.2s', color: pulse ? '#fff' : 'var(--gold2)' }}>{formatBtc(shown)}</span>
            <small>BTC</small>
          </div>
          <span className="mute" style={{ fontSize: '14px' }}>≈ ${formatUsd(shown * BTC_USD)}</span>
          <div className="payout">
            <div><span>Next payout</span><b>{pay.text}</b></div>
            <div className="bar" role="progressbar" aria-label="Time until next payout" aria-valuenow={Math.round(pay.pct)} aria-valuemin={0} aria-valuemax={100}>
              <i style={{ width: `${pay.pct}%` }} />
            </div>
          </div>
          {latest && (
            <div className="chips">
              <span key={latest.id} className="live">+{latest.sats} sat · {ago(now, latest.at)}</span>
            </div>
          )}
        </div>

        <div className="stats">
          <div className="stat">
            <span>Hashrate</span>
            <b>{totalTh}<small>TH/s</small></b>
            <Spark values={stats.hash} />
          </div>
          <div className="stat">
            <span>Today</span>
            <b>+{formatBtc(TODAY_BTC, 5)}<small>BTC</small></b>
            <Spark values={earnings.week.map((d) => d.usd)} />
          </div>
          <div className="stat">
            <span>Uptime</span>
            <b>99.8<small>%</small></b>
            <Spark values={stats.uptime} color="var(--green)" />
          </div>
        </div>

        <div className="grid">
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
        </div>
      </div>
    </>
  );
}
