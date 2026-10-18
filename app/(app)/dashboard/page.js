'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { markDrill } from '@/lib/nav';
import Spark from '@/components/Spark';
import { useMinedFeed, useNow, formatBtc, formatUsd, BTC_USD } from '@/lib/useMined';
import { useCountUp } from '@/lib/useCountUp';
import { contracts, earnings, stats, notifications, TODAY_BTC } from '@/lib/data';
import RigArt, { rigFor } from '@/components/RigArt';
import { useApi } from '@/lib/api';

// Shown until the server answers the first time.
const seedTh = contracts.reduce((s, c) => s + c.th, 0);

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
            <stop offset="0" stopColor="#e9c46a" stopOpacity=".4" />
            <stop offset="100%" stopColor="#e9c46a" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${line} L300 120 L0 120Z`} fill="url(#g)" />
        <path d={line} fill="none" stroke="#f6dc9a" strokeWidth="2.2" vectorEffect="non-scaling-stroke" />
        {!a && <circle cx={pts[last][0]} cy={pts[last][1]} r="4.5" fill="var(--gold2)" stroke="var(--bg)" strokeWidth="2" />}
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

  // Totals and the unread count come from the cached API: instant from cache, refreshed quietly.
  const { data: dd } = useApi('/api/dashboard', { ttl: 30000, poll: 60000 });
  const { data: nd } = useApi('/api/notifications', { ttl: 10000 });
  const dash = dd || { totalTh: seedTh, todayBtc: TODAY_BTC, earnings, stats };
  const unread = nd ? nd.unread : notifications.length;

  // The user's miners drive the live strip, the projection and the miner row.
  const { data: md } = useApi('/api/miners', { ttl: 10000 });
  const miners = md ? md.contracts : [];
  const online = miners.filter((c) => c.online);
  const dailyUsd = online.reduce((s, c) => s + c.dailyUsd, 0);
  const biggest = [...online].sort((a, b) => b.th - a.th)[0];
  const rig = rigFor(biggest || 'starter');

  const rows = dash.earnings[range];
  const labels =
    range === 'week' ? rows.map((d) => d.label) : [rows[0].day, rows[Math.floor(rows.length / 2)].day, 'Today'];
  const avg = rows.reduce((s, d) => s + d.usd, 0) / rows.length;
  const d = now ? new Date(now) : null;
  const dim = d ? new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() : 30;
  const dom = d ? d.getDate() : 1;
  const monthUsd = dailyUsd * dim;
  const yearUsd = dailyUsd * 365;
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
        <div className="topact">
          <span className="pill"><i />Live</span>
          <Link
            href="/notifications"
            className="bell"
            aria-label={unread ? `Notifications, ${unread} new` : 'Notifications'}
            onClick={() => markDrill()}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 8a6 6 0 1112 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 003.4 0" />
            </svg>
            {unread > 0 && <i />}
          </Link>
        </div>
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
        </div>

        <div className="card lstrip">
          <RigArt kind={rig.kind} units={rig.units} speed={rig.speed} id="live" />
          <div className="li">
            <div className="hr">
              <b>{online.length}<small>of {miners.length} miners online</small></b>
              <span><i />{online.length ? 'Mining' : 'Idle'}</span>
            </div>
            <div className={`meter ${online.length ? '' : 'off'}`} aria-hidden="true">
              {Array.from({ length: 14 }).map((_, i) => (
                <i key={i} style={{ animationDelay: `${(i * 0.13) % 1.4}s`, animationDuration: `${1 + (i % 4) * 0.2}s` }} />
              ))}
            </div>
            <div className="ticker">
              {shares.slice(0, 3).map((s) => (
                <div key={s.id}><b>+{s.sats} sat</b><span>{ago(now, s.at)}</span></div>
              ))}
            </div>
          </div>
        </div>

        <div className="stats">
          <div className="stat">
            <span>Hashrate</span>
            <b>{dash.totalTh}<small>TH/s</small></b>
            <Spark values={dash.stats.hash} />
          </div>
          <div className="stat">
            <span>Today</span>
            <b>+{formatBtc(dash.todayBtc, 5)}<small>BTC</small></b>
            <Spark values={dash.earnings.week.map((d) => d.usd)} />
          </div>
          <div className="stat">
            <span>Uptime</span>
            <b>99.8<small>%</small></b>
            <Spark values={dash.stats.uptime} color="var(--green)" />
          </div>
        </div>

        <div className="card">
          <div className="cardhead">
            <h3>Projected earnings</h3>
            <small className="mute" style={{ fontSize: '12px' }}>estimate</small>
          </div>
          {online.length ? (
            <>
              <div className="proj">
                <div>
                  <span>THIS MONTH</span>
                  <b>${formatUsd(monthUsd)}</b>
                  <small>≈ {formatBtc(monthUsd / BTC_USD, 5)} BTC</small>
                </div>
                <div>
                  <span>NEXT 12 MONTHS</span>
                  <b>${formatUsd(yearUsd)}</b>
                  <small>≈ {formatBtc(yearUsd / BTC_USD, 4)} BTC</small>
                </div>
              </div>
              <div className="bar" role="progressbar" aria-label="Days of the month passed" aria-valuenow={Math.round((dom / dim) * 100)} aria-valuemin={0} aria-valuemax={100}>
                <i style={{ width: `${(dom / dim) * 100}%` }} />
              </div>
              <small className="mute" style={{ fontSize: '12px', display: 'block', marginTop: 6 }}>Day {dom} of {dim} · from your online miners at today&apos;s rates</small>
            </>
          ) : (
            <p className="empty">No online miners yet. Buy a plan to see projections.</p>
          )}
        </div>

        {miners.length > 0 && (
          <div>
            <div className="cardhead">
              <h3>My miners · {miners.length}</h3>
            </div>
            <div className="mrail">
              {miners.map((c) => {
                const r = rigFor(c);
                return (
                  <Link key={c.serial} href={`/miners/${c.serial}`} className={`mcard ${c.online ? '' : 'off'}`} onClick={() => markDrill()}>
                    <RigArt kind={r.kind} units={r.units} speed={r.speed} id={`m${c.serial}`} />
                    <b>{c.name}</b>
                    <div className="row2">
                      <em>${formatUsd(c.dailyUsd)}/day</em>
                      <i className="st" role="img" aria-label={c.online ? 'Online' : 'Offline'} />
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

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
