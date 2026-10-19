'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { markDrill } from '@/lib/nav';
import Spark from '@/components/Spark';
import { useMinedFeed, useNow, formatBtc, formatUsd, BTC_USD } from '@/lib/useMined';
import { useCountUp } from '@/lib/useCountUp';
import { notifications, halls, MIN_WITHDRAW } from '@/lib/data';
import RigArt, { rigFor } from '@/components/RigArt';
import { useApi } from '@/lib/api';
import { triggerHaptic } from '@/lib/haptics';

// Shown until the server answers the first time.
const EMPTY = { hasMiners: false, totalTh: 0, todayBtc: 0, totalBtc: 0, uptime: null, earnings: { week: [], all: [] }, stats: { hash: [], uptime: [] } };

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
  const max = Math.max(...rows.map((d) => d.usd)) || 1;
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
            <stop offset="0" stopColor="var(--gold)" stopOpacity=".4" />
            <stop offset="100%" stopColor="var(--gold)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${line} L300 120 L0 120Z`} fill="url(#g)" />
        <path d={line} fill="none" stroke="var(--gold2)" strokeWidth="2.2" vectorEffect="non-scaling-stroke" />
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

const KIND = {
  payout: { glyph: '↓', cls: 'in' },
  deposit: { glyph: '+', cls: 'in' },
  purchase: { glyph: '◆', cls: 'buy' },
  referral: { glyph: '+', cls: 'in' },
  withdrawal: { glyph: '↑', cls: 'out' },
};
const SPLIT = ['var(--gold2)', 'var(--green)', 'var(--gold)', 'var(--mute)'];
const GOALS = [MIN_WITHDRAW, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1];

// Where the daily earnings come from. Tap a legend row to look at one slice.
function Split({ rows }) {
  const [sel, setSel] = useState(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setOn(true), 60);
    return () => clearTimeout(t);
  }, []);
  const total = rows.reduce((s, r) => s + r.usd, 0) || 1;
  const R = 42;
  const C = 2 * Math.PI * R;
  let acc = 0;
  const segs = rows.map((r, i) => {
    const seg = { ...r, color: SPLIT[i % SPLIT.length], len: (r.usd / total) * C, off: acc };
    acc += seg.len;
    return seg;
  });
  const cur = sel === null ? null : segs[sel];
  return (
    <div className="split">
      <div className="donut">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r={R} fill="none" stroke="var(--s4)" strokeWidth="12" />
          {segs.map((s, i) => (
            <circle
              key={s.name}
              cx="50"
              cy="50"
              r={R}
              fill="none"
              stroke={s.color}
              strokeWidth="12"
              strokeDasharray={`${on ? Math.max(0, s.len - (segs.length > 1 ? 1.5 : 0)) : 0} ${C}`}
              strokeDashoffset={-s.off}
              transform="rotate(-90 50 50)"
              style={{ opacity: sel === null || sel === i ? 1 : 0.25 }}
            />
          ))}
        </svg>
        <div className="mid">
          <b>${formatUsd(cur ? cur.usd : total)}</b>
          <small>{cur ? cur.name : 'per day'}</small>
        </div>
      </div>
      <div className="legend" role="group" aria-label="Earnings split">
        {segs.map((s, i) => (
          <button key={s.name} type="button" aria-pressed={sel === i} onClick={() => setSel(sel === i ? null : i)}>
            <i style={{ background: s.color }} />
            <span>{s.name}</span>
            <b>{Math.round((s.usd / total) * 100)}%</b>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  // The user's miners drive the live strip, the projection, the miner row and the live feed.
  const { data: md } = useApi('/api/miners', { ttl: 10000 });
  const miners = md ? md.contracts : [];
  const online = miners.filter((c) => c.online);
  const dailyUsd = online.reduce((s, c) => s + c.dailyUsd, 0);

  const { data: dd } = useApi('/api/dashboard', { ttl: 30000, poll: 60000 });
  const dash = dd || EMPTY;

  const { mined, shares } = useMinedFeed(dailyUsd, dash.totalBtc);
  const shown = useCountUp(mined);
  const now = useNow(1000);
  const [range, setRange] = useState('week');
  const [pulse, setPulse] = useState(false);
  const [by, setBy] = useState('hall');
  const [armed, setArmed] = useState(false);
  const [actOpen, setActOpen] = useState(false);
  const { data: cat } = useApi('/api/plans', { ttl: 20000 });
  const { data: pd } = useApi('/api/prices', { ttl: 30000, poll: 30000 });
  const { data: rd } = useApi('/api/referrals', { ttl: 30000 });
  const { data: wd } = useApi('/api/wallet', { ttl: 10000 });

  // Lets the goal bar grow from empty once the page is on screen.
  useEffect(() => {
    const t = setTimeout(() => setArmed(true), 60);
    return () => clearTimeout(t);
  }, []);

  // Totals and the unread count come from the cached API: instant from cache, refreshed quietly.
  const { data: nd } = useApi('/api/notifications', { ttl: 10000 });
  const unread = nd ? nd.unread : notifications.length;

  const biggest = [...online].sort((a, b) => b.th - a.th)[0];
  const rig = rigFor(biggest || 'starter');

  const rows = dash.earnings[range];
  const hasChart = dash.hasMiners && rows.length > 1;
  const labels = !hasChart
    ? []
    : range === 'week'
      ? rows.map((d) => d.label)
      : [rows[0].day, rows[Math.floor(rows.length / 2)].day, 'Today'];
  const avg = hasChart ? rows.reduce((s, d) => s + d.usd, 0) / rows.length : 0;
  const d = now ? new Date(now) : null;
  const dim = d ? new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() : 30;
  const dom = d ? d.getDate() : 1;
  const monthUsd = dailyUsd * dim;
  const yearUsd = dailyUsd * 365;
  const pay = payoutIn(now);

  // Split of the daily earnings, by hall or by plan.
  const hallName = (id) => ((cat && cat.halls[id]) || halls[id])?.name || id;
  const split = Object.values(
    online.reduce((m, c) => {
      const k = by === 'hall' ? hallName(c.hall) : c.plan;
      (m[k] ||= { name: k, usd: 0 }).usd += c.dailyUsd;
      return m;
    }, {})
  ).sort((a, b) => b.usd - a.usd);

  // Days in a row with earnings, counting back from today, and the next BTC goal.
  const all = dash.earnings.all;
  let streak = 0;
  for (let i = all.length - 1; i >= 0 && all[i].usd > 0; i--) streak += 1;
  const goal = GOALS.find((g) => g > mined) || GOALS[GOALS.length - 1];
  const goalPct = Math.min(100, (mined / goal) * 100);
  const toGo = Math.max(0, goal - mined);

  const btc = pd?.prices?.btc ?? BTC_USD;
  const tr = pd?.trend;
  const friends = rd?.friends?.length ?? 0;
  // Newest first. Rows without a timestamp (the demo's samples) keep their order, after the dated ones.
  const history = [...(wd?.history ?? [])].sort((a, b) => (b.at || 0) - (a.at || 0));
  const latest = history[0];

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
      <div className="grid rise">
        <div className="card hero">
          <span className="mute eyebrow">Total mined</span>
          <div className="big">
            <span style={{ transition: 'color 0.2s', color: pulse ? 'var(--text)' : 'var(--gold2)' }}>{formatBtc(shown)}</span>
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
            <b>{dash.uptime == null ? '–' : <>{dash.uptime.toFixed(1)}<small>%</small></>}</b>
            <Spark values={dash.stats.uptime} color="var(--green)" />
          </div>
        </div>

        <div className="card">
          <div className="cardhead">
            <div>
              <h3>Daily earnings</h3>
              <small className="mute" style={{ fontSize: '12px' }}>{hasChart ? `avg $${formatUsd(avg)}/day` : 'no earnings yet'}</small>
            </div>
            <div className="minitabs" role="group" aria-label="Chart range">
              <button aria-pressed={range === 'week'} onClick={() => setRange('week')}>7d</button>
              <button aria-pressed={range === 'all'} onClick={() => setRange('all')}>All</button>
            </div>
          </div>
          {!hasChart && <p className="empty">Your daily earnings will show here once a miner is live.</p>}
          <div key={range}>
            {hasChart && <ChartBox rows={rows} />}
            <div className="chartlabels">
              {labels.map((l, i) => (
                <span key={l + i} className={i === labels.length - 1 ? 'now' : undefined}>{l}</span>
              ))}
            </div>
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
                      <i className="mdot" role="img" aria-label={c.online ? 'Online' : 'Offline'} />
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {split.length > 0 && (
          <div className="card">
            <div className="cardhead">
              <h3>Earnings split</h3>
              <div className="minitabs" role="group" aria-label="Split by">
                <button aria-pressed={by === 'hall'} onClick={() => setBy('hall')}>Hall</button>
                <button aria-pressed={by === 'plan'} onClick={() => setBy('plan')}>Plan</button>
              </div>
            </div>
            <Split key={by} rows={split} />
          </div>
        )}

        {dash.hasMiners && (
          <div className="card">
            <div className="cardhead">
              <h3>Next goal</h3>
              {streak > 1 && <span className="streak">{streak}-day streak</span>}
            </div>
            <div className="goal">
              <b>{formatBtc(goal, 4)}<small>BTC</small></b>
              <span>{goal === MIN_WITHDRAW ? 'Minimum withdrawal' : 'Milestone'}</span>
            </div>
            <div className="bar goalbar" role="progressbar" aria-label="Progress to the next goal" aria-valuenow={Math.round(goalPct)} aria-valuemin={0} aria-valuemax={100}>
              <i style={{ width: `${armed ? goalPct : 0}%` }} />
            </div>
            <small className="mute" style={{ fontSize: '12px', display: 'block', marginTop: 6 }}>
              {formatBtc(mined, 5)} of {formatBtc(goal, 5)} BTC · ≈ ${formatUsd(toGo * btc)} to go
            </small>
          </div>
        )}

        <div className="pair">
          <div className="stat">
            <span>Bitcoin</span>
            <b>
              ${Math.round(btc).toLocaleString('en-US')}
              {tr && <small className={`chg ${tr.change >= 0 ? 'up' : 'down'}`}>{tr.change >= 0 ? '+' : ''}{tr.change.toFixed(1)}%</small>}
            </b>
            {tr ? <Spark values={tr.spark} color={tr.change >= 0 ? 'var(--green)' : 'var(--red)'} /> : <small className="sub">24h change unavailable</small>}
          </div>
          <Link href="/referrals" className="stat" onClick={() => markDrill()}>
            <span>Invite friends</span>
            {rd && rd.unlocked === false ? (
              <>
                <b>Earn BTC</b>
                <small className="sub">Unlocks with a miner</small>
              </>
            ) : friends === 0 ? (
              <>
                <b>Earn BTC</b>
                <small className="sub">{rd?.reward || 'Invite friends'}</small>
              </>
            ) : (
              <>
                <b>+{formatBtc(rd ? parseFloat(rd.earnedBtc) : 0, 5)}<small>BTC</small></b>
                <small className="sub">{friends} {friends === 1 ? 'friend' : 'friends'}</small>
              </>
            )}
            <span className="invite">{rd && rd.unlocked === false ? 'Learn more' : 'Invite'}</span>
          </Link>
        </div>

        {history.length > 0 && (
          <div className="card act">
            <div className="cardhead" style={{ marginBottom: actOpen ? 8 : 0 }}>
              <button
                type="button"
                className="collapse"
                aria-expanded={actOpen}
                onClick={() => {
                  triggerHaptic('selection');
                  setActOpen(!actOpen);
                }}
              >
                <h3>Recent activity</h3>
                {!actOpen && latest && <span className="mute">{latest.date}</span>}
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
              </button>
            </div>
            {!actOpen && latest && (
              <div className="row" style={{ paddingTop: 4 }}>
                <div style={{ fontWeight: 500, fontSize: '13.5px' }}>{latest.label}</div>
                <b className={latest.amount.startsWith('+') ? 'up' : ''} style={{ fontSize: '13.5px', fontVariantNumeric: 'tabular-nums' }}>
                  {latest.amount}{latest.coin ? ` ${latest.coin}` : ''}
                </b>
              </div>
            )}
            {actOpen && history.slice(0, 5).map((h, i) => {
              const k = KIND[h.kind] || KIND.payout;
              return (
                <div key={`${h.date}-${i}`} className="row" style={{ animationDelay: `${i * 60}ms` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span className={`kind ${k.cls}`} aria-hidden="true">{k.glyph}</span>
                    <div>
                      <div style={{ fontWeight: 500, fontSize: '13.5px' }}>{h.label}</div>
                      <small>{h.date}</small>
                    </div>
                  </div>
                  <b className={h.amount.startsWith('+') ? 'up' : ''} style={{ fontSize: '13.5px', fontVariantNumeric: 'tabular-nums' }}>
                    {h.amount}{h.coin ? ` ${h.coin}` : ''}
                  </b>
                </div>
              );
            })}
            {actOpen && (
              <Link href="/wallet" className="mute" style={{ display: 'block', textAlign: 'center', fontSize: '12px', padding: '12px 0 4px' }}>See all activity</Link>
            )}
          </div>
        )}
      </div>
    </>
  );
}
