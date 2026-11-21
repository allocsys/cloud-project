'use client';
// The numbers that tick every second live here, in tiny components, so the 1s timer
// re-renders only the number itself — not the whole dashboard or wallet page.
// The dashboard used to re-render in full three times a second (two useAccrued, one
// useNow, plus a pulse effect); the wallet once a second. Now each leaf owns its own
// timer and the pages only re-render when their data changes.
import { useEffect, useState } from 'react';
import { useAccrued, useNow, formatBtc, formatUsd, BTC_USD } from '@/lib/useMined';
import CountUp from '@/components/CountUp';
import { MIN_WITHDRAW_USD } from '@/lib/data';

// The first goal is the minimum withdrawal (set by the admin, in dollars); the milestones after it are fixed and only those above it are used.
const GOALS = [0, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1];

// "4s ago" / "2m ago", ticking once a second. Only this span re-renders.
export function Ago({ t, at }) {
  const now = useNow(1000);
  if (!now) return t('dash.now');
  const s = Math.max(0, Math.floor((now - at) / 1000));
  return s < 60 ? t('dash.sec', { n: s }) : t('dash.min', { n: Math.floor(s / 60) });
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

// The payout countdown and its progress bar, ticking once a second.
export function PayoutCountdown({ t }) {
  const now = useNow(1000);
  const pay = payoutIn(now);
  return (
    <div className="payout">
      <div><span>{t('dash.nextPayout')}</span><b>{pay.text}</b></div>
      <div className="bar" role="progressbar" aria-label={t('dash.payoutAria')} aria-valuenow={Math.round(pay.pct)} aria-valuemin={0} aria-valuemax={100}>
        <i style={{ width: `${pay.pct}%` }} />
      </div>
    </div>
  );
}

// The hero's big mined total: the server figure plus the online rate since the server's
// asOf, eased up from zero once when the screen opens, flashing gold on each new share.
// `week` is the optional "this week" span shown next to the USD line.
export function HeroMined({ totalBtc, dailyUsd, asOf, week }) {
  const mined = totalBtc + useAccrued(dailyUsd, asOf);
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    setPulse(true);
    const t = setTimeout(() => setPulse(false), 300);
    return () => clearTimeout(t);
  }, [mined]);
  return (
    <>
      <div className="big">
        <span style={{ transition: 'color 0.2s', color: pulse ? 'var(--text)' : 'var(--gold2)' }}><CountUp value={mined} format={formatBtc} /></span>
        <small>BTC</small>
      </div>
      <div className="hsub">
        <span className="mute">≈ $<CountUp value={mined} format={(v) => formatUsd(v * BTC_USD)} /></span>
        {week}
      </div>
    </>
  );
}

// The next-BTC-goal card: its bar, line and ETA follow the balance you can actually
// withdraw (mined + deposits + invite rewards - withdrawn - spent), plus what the live
// feed added since this page opened.
export function GoalProgress({ wd, dailyUsd, btc, minUsd = MIN_WITHDRAW_USD, armed, t }) {
  const gain = useAccrued(dailyUsd, wd ? wd.asOf : null);
  const avail = wd ? Math.max(0, wd.earned - wd.withdrawn - (wd.spent || 0)) + gain : 0;
  const minBtc = minUsd / (btc > 0 ? btc : BTC_USD);
  const goals = [minBtc, ...GOALS.slice(1).filter((g) => g > minBtc)];
  const goal = goals.find((g) => g > avail) || goals[goals.length - 1];
  const goalPct = Math.min(100, (avail / goal) * 100);
  const toGo = Math.max(0, goal - avail);
  // Days to the goal at today's daily earnings (online miners), rounded up. Null when
  // nothing is earning or the goal is reached.
  const etaDays = dailyUsd > 0 && toGo > 0 ? Math.ceil((toGo * btc) / dailyUsd) : null;
  const etaText = etaDays === null ? '' : etaDays > 365 ? t('dash.etaYear') : etaDays <= 1 ? t('dash.etaDay') : t('dash.etaDays', { n: etaDays });
  return (
    <>
      <div className="goal">
        <b>{formatBtc(goal, 4)}<small>BTC</small></b>
        <span>{goal === minBtc ? t('dash.minWd') : t('dash.milestone')}</span>
      </div>
      <div className="bar goalbar" role="progressbar" aria-label={t('dash.goalAria')} aria-valuenow={Math.round(goalPct)} aria-valuemin={0} aria-valuemax={100}>
        <i style={{ width: `${armed ? goalPct : 0}%` }} />
      </div>
      <small className="mute" style={{ fontSize: '12px', display: 'block', marginTop: 6 }}>
        {t('dash.goalLine', { a: formatBtc(avail, 5), g: formatBtc(goal, 5), usd: formatUsd(toGo * btc) })}
      </small>
      {etaText && <small className="mute" style={{ fontSize: '12px', display: 'block', marginTop: 4 }}>{t('dash.eta', { when: etaText })}</small>}
    </>
  );
}

// The wallet hero's balance: available (earned + live accrual - withdrawn - spent) and
// the total mined, ticking once a second. The live figure is also written to liveRef so
// the page's tap handlers (max fill, withdraw check) see the same number on screen;
// the page itself keeps the server figure for render-time logic (reinvest suggestion).
export function WalletBalance({ wd, dailyUsd, btcUsd, liveRef, t }) {
  const mined = useAccrued(dailyUsd, wd ? wd.asOf : null);
  const earned = (wd ? wd.earned : 0) + mined;
  const available = wd ? Math.max(0, earned - wd.withdrawn - (wd.spent || 0)) : 0;
  useEffect(() => {
    if (liveRef) liveRef.current = available;
  }, [available, liveRef]);
  if (!wd) {
    // No answer yet: the same lines as below, in the loading look (.ld), so nothing moves when the balance arrives.
    return (
      <div className="ld" aria-busy="true" style={{ display: 'contents' }}>
        <div className="big">
          <span>0.00000000</span>
          <small>BTC</small>
        </div>
        <span className="mute" style={{ display: 'block', fontSize: '14px' }}>≈ $0.00</span>
        <span className="mute" style={{ display: 'block', fontSize: '12.5px', marginTop: '2px' }}>{t('wal.totalMined', { n: '0.00000000' })}</span>
      </div>
    );
  }
  return (
    <>
      <div className="big">
        {wd ? formatBtc(available) : '—'}
        <small>BTC</small>
      </div>
      <span className="mute" style={{ display: 'block', fontSize: '14px' }}>{wd ? `≈ $${formatUsd(available * btcUsd)}` : '\u00a0'}</span>
      <span className="mute" style={{ display: 'block', fontSize: '12.5px', marginTop: '2px' }}>{wd && wd.mined != null ? t('wal.totalMined', { n: formatBtc(wd.mined + mined) }) : '\u00a0'}</span>
    </>
  );
}
