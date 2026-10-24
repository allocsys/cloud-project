'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { markDrill } from '@/lib/nav';
import Spark from '@/components/Spark';
import { useMinedFeed, useAccrued, useNow, formatBtc, formatUsd, BTC_USD } from '@/lib/useMined';
import { useCountUp } from '@/lib/useCountUp';
import { notifications, halls, MIN_WITHDRAW } from '@/lib/data';
import RigArt, { rigFor } from '@/components/RigArt';
import { useApi } from '@/lib/api';
import { triggerHaptic } from '@/lib/haptics';
import { smartPick, reinvestTitle, reinvestHref } from '@/lib/reinvest';

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

const KIND = {
  payout: { glyph: '↓', cls: 'in' },
  deposit: { glyph: '+', cls: 'in' },
  purchase: { glyph: '◆', cls: 'buy' },
  referral: { glyph: '+', cls: 'in' },
  withdrawal: { glyph: '↑', cls: 'out' },
  adjustment: { glyph: '±', cls: 'in' },
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

// Week area chart inside the Total mined card.
function HeroChart({ rows }) {
  const n = rows.length;
  const max = Math.max(...rows.map((d) => d.usd)) || 1;
  const y = (usd) => 74 - (usd / max) * 64;
  const line = rows.map((d, i) => `${i === 0 ? 'M' : 'L'}${((i * 300) / (n - 1)).toFixed(1)} ${y(d.usd).toFixed(1)}`).join(' ');
  return (
    <div className="hchart">
      <div className="hplot">
      <svg viewBox="0 0 300 80" preserveAspectRatio="none" role="img" aria-label="Earnings over the last 7 days">
        <line x1="0" y1="26" x2="300" y2="26" className="hgrid" vectorEffect="non-scaling-stroke" />
        <line x1="0" y1="52" x2="300" y2="52" className="hgrid" vectorEffect="non-scaling-stroke" />
        <path d={`${line} L300 80 L0 80 Z`} className="harea" />
        <path d={line} className="hline" vectorEffect="non-scaling-stroke" />
      </svg>
      <i className="hdot" style={{ top: `${(y(rows[n - 1].usd) / 80) * 100}%` }} />
      </div>
      <div className="hdays" aria-hidden="true">
        {rows.map((d, i) => <span key={i}>{d.label}</span>)}
      </div>
    </div>
  );
}

export default function Dashboard() {
  // The user's miners drive the live strip, the projection, the miner row and the live feed.
  const { data: md } = useApi('/api/miners', { ttl: 10000 });
  const miners = md ? md.contracts : [];
  const online = miners.filter((c) => c.online);
  const pausedN = online.filter((c) => c.paused).length; // switched off today by the profit guard
  const dailyUsd = online.reduce((s, c) => s + c.dailyUsd, 0);

  const { data: dd } = useApi('/api/dashboard', { ttl: 30000, poll: 60000 });
  const dash = dd || EMPTY;

  // Shares are a simulated feed. The big number is the server figure plus the online rate since the server's asOf,
  // the same maths the Wallet uses, so the two screens agree.
  const { shares } = useMinedFeed(dailyUsd);
  const mined = dash.totalBtc + useAccrued(dailyUsd, dd ? dd.asOf : null);
  const shown = useCountUp(mined);
  const now = useNow(1000);
  const [pulse, setPulse] = useState(false);
  const [by, setBy] = useState('hall');
  const [armed, setArmed] = useState(false);
  const [actOpen, setActOpen] = useState(false);
  const [minersOpen, setMinersOpen] = useState(false);
  const [slide, setSlide] = useState(0);
  const railRef = useRef(null);
  const onRail = (e) => {
    const el = e.currentTarget;
    const first = el.firstElementChild;
    if (!first) return;
    setSlide(Math.min(1, Math.max(0, Math.round(el.scrollLeft / (first.offsetWidth + 10)))));
  };
  const goSlide = (i) => {
    const el = railRef.current;
    if (!el || !el.children[i]) return;
    el.scrollTo({ left: el.children[i].offsetLeft - el.children[0].offsetLeft, behavior: 'smooth' });
  };
  const { data: cat } = useApi('/api/plans', { ttl: 20000 });
  const { data: pd } = useApi('/api/prices', { ttl: 30000, poll: 30000 });
  const { data: rd } = useApi('/api/referrals', { ttl: 30000 });
  const { data: wd } = useApi('/api/wallet', { ttl: 10000 });
  const gain = useAccrued(dailyUsd, wd ? wd.asOf : null);

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

  const d = now ? new Date(now) : null;
  const dim = d ? new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() : 30;
  const dom = d ? d.getDate() : 1;
  const monthUsd = dailyUsd * dim;
  const yearUsd = dailyUsd * 365;
  const pay = payoutIn(now);
  const week = dash.earnings.week;
  const hasWeek = dash.hasMiners && week.length > 1;
  const weekUsd = week.reduce((t, w) => t + w.usd, 0);
  const weekAvg = dash.avgUsd || 0;

  // Split of the daily earnings, by hall or by plan.
  const hallName = (id) => (id === 'smart' ? 'Smart Mining' : ((cat && cat.halls[id]) || halls[id])?.name || id);
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
  // The goal follows the balance you can actually withdraw (mined + deposits + invite rewards - withdrawn - spent),
  // the same number as the Wallet screen, plus what the live feed added since this page opened.
  const avail = wd ? Math.max(0, wd.earned - wd.withdrawn - (wd.spent || 0)) + gain : 0;
  const goal = GOALS.find((g) => g > avail) || GOALS[GOALS.length - 1];
  const goalPct = Math.min(100, (avail / goal) * 100);
  const toGo = Math.max(0, goal - avail);

  const btc = pd?.prices?.btc ?? BTC_USD;
  // Days to the goal at today's daily earnings (online miners), rounded up. Null when nothing is earning or the goal is reached.
  const etaDays = dailyUsd > 0 && toGo > 0 ? Math.ceil((toGo * btc) / dailyUsd) : null;
  const etaText = etaDays === null ? '' : etaDays > 365 ? 'over a year' : etaDays <= 1 ? 'about a day' : `about ${etaDays} days`;
  const tr = pd?.trend;
  const friends = rd?.friends?.length ?? 0;
  // Newest first. Rows without a timestamp (the demo's samples) keep their order, after the dated ones.
  const history = [...(wd?.history ?? [])].sort((a, b) => (b.at || 0) - (a.at || 0));
  const latest = history[0];
  // Balance that can pay for a plan, in USD at the live rate. The Reinvest card shows once it covers a plan.
  const balUsd = wd ? Math.max(0, wd.earned - wd.withdrawn - (wd.spent || 0)) * btc : 0;
  const rein = smartPick([], balUsd, cat ? cat.halls : undefined);

  useEffect(() => {
    setPulse(true);
    const t = setTimeout(() => setPulse(false), 300);
    return () => clearTimeout(t);
  }, [mined]);

  return (
    <>
      <div className="top">
        <h2>Earnings<i className="ldot" role="img" aria-label="Live" /></h2>
        <div className="topact">
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
        <div className="crlwrap">
          <div className="crl" ref={railRef} onScroll={onRail}>
            <div className="card hero">
              <div className="hhead">
                <span className="mute eyebrow">Total mined</span>
                {shares[0] && <span className="hchip">+{shares[0].sats} sat · {ago(now, shares[0].at)}</span>}
              </div>
              <div className="big">
                <span style={{ transition: 'color 0.2s', color: pulse ? 'var(--text)' : 'var(--gold2)' }}>{formatBtc(shown)}</span>
                <small>BTC</small>
              </div>
              <div className="hsub">
                <span className="mute">≈ ${formatUsd(shown * BTC_USD)}</span>
                {hasWeek && weekUsd > 0 && <span className="hwk">${formatUsd(weekUsd)} this week</span>}
              </div>
              {hasWeek && <HeroChart rows={week} />}
              <div className="hrow">
                <div className="hk">{dash.totalTh > 0 || !(dash.smartBudget > 0) ? <><b>{dash.totalTh}</b><span>TH/s</span></> : <><b>${Math.round(dash.smartBudget).toLocaleString('en-US')}</b><span>Smart budget</span></>}</div>
                <div className="hk ok"><b>{dash.uptime == null ? '–' : `${dash.uptime.toFixed(1)}%`}</b><span>Uptime</span></div>
                <div className="hk"><b>+{Math.round(dash.todayBtc * 1e8)}</b><span>Sat today</span></div>
                <div className="hk"><b>${formatUsd(weekAvg)}</b><span>Avg/day</span></div>
              </div>
              <div className="payout">
                <div><span>Next payout</span><b>{pay.text}</b></div>
                <div className="bar" role="progressbar" aria-label="Time until next payout" aria-valuenow={Math.round(pay.pct)} aria-valuemin={0} aria-valuemax={100}>
                  <i style={{ width: `${pay.pct}%` }} />
                </div>
              </div>
            </div>
            <div className="card">
              <div className="cardhead">
                <h3>Earnings</h3>
                <small className="mute" style={{ fontSize: '12px' }}>estimate</small>
              </div>
              {online.length ? (
                <>
                  <div className="eprj">
                    <svg viewBox="0 0 120 120" role="img" aria-label={`Day ${dom} of ${dim}`}>
                      <circle className="erg-track" cx="60" cy="60" r="51" />
                      <circle className="erg-fill" cx="60" cy="60" r="51" strokeDasharray={`${((dom / dim) * 320.4).toFixed(1)} 320.4`} transform="rotate(-90 60 60)" />
                      <text className="erg-mute" x="60" y="53">Day</text>
                      <text className="erg-num" x="60" y="77">{dom}</text>
                      <text className="erg-mute" x="60" y="92">of {dim}</text>
                    </svg>
                    <div className="eprj-t">
                      <div>
                        <span>Projected this month</span>
                        <b>${formatUsd(monthUsd)}</b>
                        <small>≈ {formatBtc(monthUsd / BTC_USD, 5)} BTC</small>
                      </div>
                      <i className="esep" />
                      <div>
                        <span>Next 12 months</span>
                        <b>${formatUsd(yearUsd)}</b>
                        <small>≈ {formatBtc(yearUsd / BTC_USD, 4)} BTC</small>
                      </div>
                    </div>
                  </div>
                  <div className="egrid">
                    <div className="hcell"><span>Per day</span><b>${formatUsd(dailyUsd)}</b></div>
                    <div className="hcell"><span>Per week</span><b>${formatUsd(dailyUsd * 7)}</b></div>
                    <div className="hcell ok"><span>Miners</span><b>{online.length - pausedN} online{pausedN ? ` · ${pausedN} paused` : ''}</b></div>
                  </div>
                </>
              ) : (
                <p className="empty">No online miners yet. Buy a plan to see projections.</p>
              )}
            </div>
          </div>
          <div className="cdots">
            <button type="button" aria-label="Total mined" aria-current={slide === 0} onClick={() => goSlide(0)} />
            <button type="button" aria-label="Earnings projection" aria-current={slide === 1} onClick={() => goSlide(1)} />
          </div>
        </div>

        <div className="card mstrip">
          <button
            type="button"
            className="lstrip"
            aria-expanded={minersOpen}
            aria-controls="miner-list"
            disabled={!miners.length}
            onClick={() => {
              triggerHaptic('selection');
              setMinersOpen(!minersOpen);
            }}
          >
            <div className="lrow">
              <RigArt kind={rig.kind} units={rig.units} speed={rig.speed} id="live" />
              <div className="li">
                <div className="hr">
                  <b>{online.length - pausedN}<small>of {miners.length} miners online{pausedN ? `, ${pausedN} paused` : ''}</small></b>
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
            {miners.length > 0 && (
              <svg className={`mchev ${minersOpen ? 'up' : ''}`} viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 9l6 6 6-6" />
              </svg>
            )}
          </button>
          {minersOpen && miners.length > 0 && (
            <div className="mlist" id="miner-list">
              {miners.map((c) => {
                const r = rigFor(c);
                return (
                  <Link key={c.serial} href={`/miners/${c.serial}`} className={`mrow ${c.online ? '' : 'off'}`} onClick={() => markDrill()}>
                    <RigArt kind={r.kind} units={r.units} speed={r.speed} id={`m${c.serial}`} />
                    <div className="mt">
                      <b>{c.name}</b>
                      <em>${formatUsd(c.dailyUsd)}/day</em>
                    </div>
                    <i className="mdot" role="img" aria-label={c.online ? 'Online' : 'Offline'} />
                  </Link>
                );
              })}
            </div>
          )}
        </div>

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
              {formatBtc(avail, 5)} of {formatBtc(goal, 5)} BTC available · ≈ ${formatUsd(toGo * btc)} to go
            </small>
            {etaText && <small className="mute" style={{ fontSize: '12px', display: 'block', marginTop: 4 }}>Est. {etaText} at your current daily earnings</small>}
          </div>
        )}

        {rein && (
          <Link href={reinvestHref(rein)} className="card rein">
            <div>
              <b>{reinvestTitle(rein)}</b>
              <small>
                ${formatUsd(rein.plan.price)} · {rein.plan.days} days · ~{rein.plan.daily}/day
                {rein.left >= 1 ? ` · $${formatUsd(rein.left)} left` : ''}
              </small>
            </div>
            <span className="rgo">Review</span>
          </Link>
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
            {friends === 0 ? (
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
            <span className="invite">Invite</span>
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
