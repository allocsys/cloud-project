'use client';
import { HeadIcon } from '@/components/PageHead';
import WalletPill from '@/components/WalletPill';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { markDrill } from '@/lib/nav';
import Spark from '@/components/Spark';
import { useMinedFeed, formatBtc, formatUsd, BTC_USD } from '@/lib/useMined';
import { Ago, PayoutCountdown, HeroMined, GoalProgress } from '@/components/LiveNumbers';
import { notifications, halls } from '@/lib/data';
import RigArt, { rigFor } from '@/components/RigArt';
import { useApi } from '@/lib/api';
import { triggerHaptic } from '@/lib/haptics';
import { smartPick, reinvestTitle, reinvestHref } from '@/lib/reinvest';
import { useT, useLang } from '@/components/I18nProvider';
import { histLabel, histDate } from '@/lib/i18n/history';
import RateUs from '@/components/RateUs';
import { payoutCard } from '@/lib/payout-card';
import { SkDash } from '@/components/Skeleton';

// Shown until the server answers the first time.
const EMPTY = { hasMiners: false, totalTh: 0, todayBtc: 0, totalBtc: 0, uptime: null, earnings: { week: [], all: [] }, stats: { hash: [], uptime: [] } };

const KIND = {
  payout: { glyph: '↓', cls: 'in' },
  deposit: { glyph: '+', cls: 'in' },
  purchase: { glyph: '◆', cls: 'buy' },
  referral: { glyph: '+', cls: 'in' },
  withdrawal: { glyph: '↑', cls: 'out' },
  adjustment: { glyph: '±', cls: 'in' },
};
const SPLIT = ['var(--gold2)', 'var(--green)', 'var(--gold)', 'var(--mute)'];

// Where the daily earnings come from. Tap a legend row to look at one slice.
function Split({ rows }) {
  const t = useT();
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
          <small>{cur ? cur.name : t('dash.perDay')}</small>
        </div>
      </div>
      <div className="legend" role="group" aria-label={t('dash.split')}>
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
  const t = useT();
  const n = rows.length;
  const max = Math.max(...rows.map((d) => d.usd)) || 1;
  const y = (usd) => 74 - (usd / max) * 64;
  const line = rows.map((d, i) => `${i === 0 ? 'M' : 'L'}${((i * 300) / (n - 1)).toFixed(1)} ${y(d.usd).toFixed(1)}`).join(' ');
  return (
    <div className="hchart">
      <div className="hplot">
      <svg viewBox="0 0 300 80" preserveAspectRatio="none" role="img" aria-label={t('dash.weekAria')}>
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
  const { t, lang } = useLang();
  // One call for the per-user data (miners, dashboard, wallet, referrals, notifications):
  // five requests that each loaded the same account document are now one (lib/server/bundle.js).
  // The catalogue and the prices stay separate: they are edge-cached and polled on their own rhythm.
  const { data: bundle } = useApi('/api/dashboard/bundle', { ttl: 10000, poll: 60000 });
  const md = bundle?.miners;
  const miners = md ? md.contracts : [];
  const online = miners.filter((c) => c.online);
  const pausedN = online.filter((c) => c.paused).length; // switched off today by the profit guard
  const dailyUsd = online.reduce((s, c) => s + c.dailyUsd, 0);

  const dd = bundle?.dashboard;
  const dash = dd || EMPTY;

  // Shares are a simulated feed. The numbers that tick every second (the big mined total,
  // the payout countdown, the goal bar) live in components/LiveNumbers.js, so the 1s timer
  // re-renders only the number itself — not this whole page.
  const { shares } = useMinedFeed(dailyUsd);
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
  const rd = bundle?.referrals;
  const wd = bundle?.wallet;

  // Lets the goal bar grow from empty once the page is on screen.
  useEffect(() => {
    const t = setTimeout(() => setArmed(true), 60);
    return () => clearTimeout(t);
  }, []);

  // Totals and the unread count come from the cached API: instant from cache, refreshed quietly.
  const nd = bundle?.notifications;
  const unread = nd ? nd.unread : notifications.length;

  const biggest = [...online].sort((a, b) => b.th - a.th)[0];
  const rig = rigFor(biggest || 'starter');

  // The day ring only changes at midnight; the page re-renders on its 60s data poll,
  // so a plain date at render time stays fresh without a ticking clock.
  const d = new Date();
  const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const dom = d.getDate();
  const monthUsd = dailyUsd * dim;
  const yearUsd = dailyUsd * 365;
  const week = dash.earnings.week;
  const hasWeek = dash.hasMiners && week.length > 1;
  const weekUsd = week.reduce((t, w) => t + w.usd, 0);
  const weekAvg = dash.avgUsd || 0;

  // Split of the daily earnings, by hall or by plan.
  const hallName = (id) => (id === 'smart' ? t('dash.smart') : ((cat && cat.halls[id]) || halls[id])?.name || id);
  const split = Object.values(
    online.reduce((m, c) => {
      const k = by === 'hall' ? hallName(c.hall) : c.plan;
      (m[k] ||= { name: k, usd: 0 }).usd += c.dailyUsd;
      return m;
    }, {})
  ).sort((a, b) => b.usd - a.usd);

  // Days in a row with earnings, counting back from today.
  const all = dash.earnings.all;
  let streak = 0;
  for (let i = all.length - 1; i >= 0 && all[i].usd > 0; i--) streak += 1;

  const btc = pd?.prices?.btc ?? BTC_USD;
  const tr = pd?.trend;
  const friends = rd?.friends?.length ?? 0;
  // Newest first. Rows without a timestamp (the demo's samples) keep their order, after the dated ones.
  const history = [...(wd?.history ?? [])].sort((a, b) => (b.at || 0) - (a.at || 0));
  const latest = history[0];
  // Balance that can pay for a plan, in USD at the live rate. The Reinvest card shows once it covers a plan.
  const balUsd = wd ? Math.max(0, wd.earned - wd.withdrawn - (wd.spent || 0)) * btc : 0;
  const rein = smartPick([], balUsd, cat ? cat.halls : undefined);

  // "Payout received": yesterday's earnings, shown once after the 00:00 UTC payout until closed. The closing day is kept on this device.
  const [paySeen, setPaySeen] = useState(null);
  useEffect(() => {
    try {
      setPaySeen(Number(localStorage.getItem('vtx-payout-seen')) || 0);
    } catch {
      setPaySeen(0);
    }
  }, []);
  // payoutCard only needs the current UTC day, so a plain timestamp at render time is enough — no ticking clock (the 60s data poll keeps it fresh).
  const now = Date.now();
  const paid = dd && dash.hasMiners ? payoutCard(all, now, paySeen) : null;
  const closePaid = () => {
    try {
      localStorage.setItem('vtx-payout-seen', String(paid.day));
    } catch {}
    setPaySeen(paid.day);
  };


  return (
    <>
      <div className="top rich">
        <div className="eh-l">
          <HeadIcon kind="earnings" />
          <div className="eh-ttl">
            <h2>{t('nav.earnings')}<i className="ldot" role="img" aria-label={t('dash.live')} /></h2>
            <small>{md ? (online.length ? t('dash.mining') : t('dash.idle')) : '\u00a0'}</small>
          </div>
        </div>
        <div className="topact">
          <WalletPill compact />
          <Link
            href="/notifications"
            className="bell"
            aria-label={unread ? t('dash.notifNew', { n: unread }) : t('dash.notif')}
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
        {!bundle ? <SkDash /> : <>
        {paid && (
          <div className="card" role="status" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
            <div>
              <b>{t('dash.paidYday', { usd: `$${formatUsd(paid.usd)}` })}</b>
              <small className="mute" style={{ display: 'block', marginTop: '2px' }}>{t('dash.paidNext')}</small>
            </div>
            <button type="button" className="btn" onClick={() => { triggerHaptic('selection'); closePaid(); }}>{t('dash.paidOk')}</button>
          </div>
        )}
        <div className="crlwrap">
          <div className="crl" ref={railRef} onScroll={onRail}>
            <div className="card hero">
              <div className="hhead">
                <span className="mute eyebrow">{t('dash.total')}</span>
                {shares[0] && <span className="hchip">+{shares[0].sats} {t('unit.sat')} · <Ago t={t} at={shares[0].at} /></span>}
              </div>
              <HeroMined totalBtc={dash.totalBtc} dailyUsd={dailyUsd} asOf={dd ? dd.asOf : null} week={hasWeek && weekUsd > 0 ? <span className="hwk">${formatUsd(weekUsd)} {t('dash.thisWeek')}</span> : null} />
              {hasWeek && <HeroChart rows={week} />}
              <div className="hrow">
                <div className="hk">{dash.totalTh > 0 || !(dash.smartBudget > 0) ? <><b>{dash.totalTh}</b><span>TH/s</span></> : <><b>${Math.round(dash.smartBudget).toLocaleString('en-US')}</b><span>{t('dash.smartBudget')}</span></>}</div>
                <div className="hk ok"><b>{dash.uptime == null ? '–' : `${dash.uptime.toFixed(1)}%`}</b><span>{t('dash.uptime')}</span></div>
                <div className="hk"><b>+{Math.round(dash.todayBtc * 1e8)}</b><span>{t('dash.satToday')}</span></div>
                <div className="hk"><b>${formatUsd(weekAvg)}</b><span>{t('dash.avgDay')}</span></div>
              </div>
              <PayoutCountdown t={t} />
            </div>
            <div className="card">
              <div className="cardhead">
                <h3>{t('nav.earnings')}</h3>
                <small className="mute" style={{ fontSize: '12px' }}>{t('dash.estimate')}</small>
              </div>
              {online.length ? (
                <>
                  <div className="eprj">
                    <svg viewBox="0 0 120 120" role="img" aria-label={t('dash.dayOf', { d: dom, n: dim })}>
                      <circle className="erg-track" cx="60" cy="60" r="51" />
                      <circle className="erg-fill" cx="60" cy="60" r="51" strokeDasharray={`${((dom / dim) * 320.4).toFixed(1)} 320.4`} transform="rotate(-90 60 60)" />
                      <text className="erg-mute" x="60" y="53">{t('dash.day')}</text>
                      <text className="erg-num" x="60" y="77">{dom}</text>
                      <text className="erg-mute" x="60" y="92">{t('dash.of', { n: dim })}</text>
                    </svg>
                    <div className="eprj-t">
                      <div>
                        <span>{t('dash.projMonth')}</span>
                        <b>${formatUsd(monthUsd)}</b>
                        <small>≈ {formatBtc(monthUsd / BTC_USD, 5)} BTC</small>
                      </div>
                      <i className="esep" />
                      <div>
                        <span>{t('dash.next12')}</span>
                        <b>${formatUsd(yearUsd)}</b>
                        <small>≈ {formatBtc(yearUsd / BTC_USD, 4)} BTC</small>
                      </div>
                    </div>
                  </div>
                  <div className="egrid">
                    <div className="hcell"><span>{t('dash.perDayCap')}</span><b>${formatUsd(dailyUsd)}</b></div>
                    <div className="hcell"><span>{t('dash.perWeek')}</span><b>${formatUsd(dailyUsd * 7)}</b></div>
                    <div className="hcell ok"><span>{t('dash.miners')}</span><b>{t('dash.nOnline', { n: online.length - pausedN })}{pausedN ? ` · ${t('dash.paused', { n: pausedN })}` : ''}</b></div>
                  </div>
                </>
              ) : (
                <p className="empty">{t('dash.noMiners')}</p>
              )}
            </div>
          </div>
          <div className="cdots">
            <button type="button" aria-label={t('dash.total')} aria-current={slide === 0} onClick={() => goSlide(0)} />
            <button type="button" aria-label={t('dash.projAria')} aria-current={slide === 1} onClick={() => goSlide(1)} />
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
                  <b>{online.length - pausedN}<small>{t('dash.minersOnline', { n: miners.length })}{pausedN ? `, ${t('dash.paused', { n: pausedN })}` : ''}</small></b>
                  <span><i />{online.length ? t('dash.mining') : t('dash.idle')}</span>
                </div>
                <div className={`meter ${online.length ? '' : 'off'}`} aria-hidden="true">
                  {Array.from({ length: 14 }).map((_, i) => (
                    <i key={i} style={{ animationDelay: `${(i * 0.13) % 1.4}s`, animationDuration: `${1 + (i % 4) * 0.2}s` }} />
                  ))}
                </div>
                <div className="ticker">
                  {shares.slice(0, 3).map((s) => (
                    <div key={s.id}><b>+{s.sats} {t('unit.sat')}</b><span><Ago t={t} at={s.at} /></span></div>
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
                      <em>${formatUsd(c.dailyUsd)}/{t('calc.day')}</em>
                    </div>
                    <i className="mdot" role="img" aria-label={c.online ? t('dash.online') : t('dash.offline')} />
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {split.length > 0 && (
          <div className="card">
            <div className="cardhead">
              <h3>{t('dash.split')}</h3>
              <div className="minitabs" role="group" aria-label={t('dash.splitBy')}>
                <button aria-pressed={by === 'hall'} onClick={() => setBy('hall')}>{t('dash.hall')}</button>
                <button aria-pressed={by === 'plan'} onClick={() => setBy('plan')}>{t('dash.plan')}</button>
              </div>
            </div>
            <Split key={by} rows={split} />
          </div>
        )}

        {dash.hasMiners && (
          <div className="card">
            <div className="cardhead">
              <h3>{t('dash.goal')}</h3>
              {streak > 1 && <span className="streak">{t('dash.streak', { n: streak })}</span>}
            </div>
            <GoalProgress wd={wd} dailyUsd={dailyUsd} btc={btc} minUsd={cat?.minWithdraw} armed={armed} t={t} />
          </div>
        )}

        {rein && (
          <Link href={reinvestHref(rein)} className="card rein">
            <div>
              <b>{reinvestTitle(rein, t)}</b>
              <small>
                {t('dash.reinLine', { price: formatUsd(rein.plan.price), days: rein.plan.days, daily: rein.plan.daily })}
                {rein.left >= 1 ? ` · ${t('dash.left', { n: formatUsd(rein.left) })}` : ''}
              </small>
            </div>
            <span className="rgo">{t('dash.review')}</span>
          </Link>
        )}

        <div className="pair">
          <div className="stat">
            <span>{t('dash.bitcoin')}</span>
            <b>
              ${Math.round(btc).toLocaleString('en-US')}
              {tr && <small className={`chg ${tr.change >= 0 ? 'up' : 'down'}`}>{tr.change >= 0 ? '+' : ''}{tr.change.toFixed(1)}%</small>}
            </b>
            {tr ? <Spark values={tr.spark} color={tr.change >= 0 ? 'var(--green)' : 'var(--red)'} /> : <small className="sub">{t('dash.noChange')}</small>}
          </div>
          <Link href="/referrals" className="stat" onClick={() => markDrill()}>
            <span>{t('dash.invite')}</span>
            {friends === 0 ? (
              <>
                <b>{t('dash.earnBtc')}</b>
                <small className="sub">{rd?.rewardV ? t('ref.reward', rd.rewardV) : rd?.reward || t('dash.invite')}</small>
              </>
            ) : (
              <>
                <b>+{formatBtc(rd ? parseFloat(rd.earnedBtc) : 0, 5)}<small>BTC</small></b>
                <small className="sub">{friends === 1 ? t('dash.friend', { n: friends }) : t('dash.friends', { n: friends })}</small>
              </>
            )}
            <span className="invite">{t('dash.inviteBtn')}</span>
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
                <h3>{t('dash.activity')}</h3>
                {!actOpen && latest && <span className="mute">{histDate(latest, lang, t)}</span>}
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
              </button>
            </div>
            {!actOpen && latest && (
              <div className="row" style={{ paddingTop: 4 }}>
                <div style={{ fontWeight: 500, fontSize: '13.5px' }}>{histLabel(latest, t)}</div>
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
                      <div style={{ fontWeight: 500, fontSize: '13.5px' }}>{histLabel(h, t)}</div>
                      <small>{histDate(h, lang, t)}</small>
                    </div>
                  </div>
                  <b className={h.amount.startsWith('+') ? 'up' : ''} style={{ fontSize: '13.5px', fontVariantNumeric: 'tabular-nums' }}>
                    {h.amount}{h.coin ? ` ${h.coin}` : ''}
                  </b>
                </div>
              );
            })}
            {actOpen && (
              <Link href="/wallet" className="mute" style={{ display: 'block', textAlign: 'center', fontSize: '12px', padding: '12px 0 4px' }}>{t('dash.seeAll')}</Link>
            )}
          </div>
        )}

        <RateUs />
        </>}
      </div>
    </>
  );
}
