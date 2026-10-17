'use client';
import { useMined, BTC_USD } from '@/lib/useMined';
import { contracts } from '@/lib/data';

const stats = [
  ['Hash power', '120 TH/s'],
  ['Today', '+0.00006 BTC', 'up'],
  ['Uptime', '99.8%'],
  ['Power cost', '$0.06/TH'],
];

export default function Dashboard() {
  const mined = useMined();
  const usd = (mined * BTC_USD).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const line = 'M0 90 L50 70 L100 80 L150 50 L200 58 L250 30 L300 38';

  return (
    <>
      <div className="top">
        <h2>Earnings</h2>
        <span className="pill"><i />Mining live</span>
      </div>
      <div className="grid">
        <div className="card hero">
          <span className="mute">Mined so far</span>
          <div className="big">{mined.toFixed(8)}<small>BTC</small></div>
          <span className="mute">≈ ${usd}</span>
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
          <div className="card">
            <h3>Last 7 days</h3>
            <svg className="spark" viewBox="0 0 300 120" preserveAspectRatio="none" aria-label="Daily earnings chart">
              <defs>
                <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#d4a84b" stopOpacity=".35" />
                  <stop offset="1" stopColor="#d4a84b" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={`${line} L300 120 L0 120Z`} fill="url(#g)" />
              <path d={line} fill="none" stroke="#f1d48a" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            </svg>
          </div>
          <div className="card">
            <h3>Active contracts</h3>
            {contracts.map((c) => (
              <div key={c.name} className="row">
                <div>{c.name}<small>Ends {c.ends}</small></div>
                <span className="up">Active</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
