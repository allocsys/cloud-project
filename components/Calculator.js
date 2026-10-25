'use client';
// The earnings calculator on the page people see before they sign in.
// It works from a budget and a term, like the Smart Mining sheet on the Plans screen (lib/smart.js). The estimate is
// budget x the pay table's payout x days, the middle of the 70%-130% band, the same estimate as the buy sheet. The live coin
// only shows in the badge and does not scale the numbers. Everything shown is an estimate, never a promise.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import RigArt, { rigFor } from '@/components/RigArt';
import { useApi } from '@/lib/api';
import { BTC_USD } from '@/lib/data';
import { SMART, smartEstimate } from '@/lib/smart';
import { triggerHaptic } from '@/lib/haptics';
import { AuthButton } from '@/components/AuthSheet';
import { fill, useT } from '@/components/I18nProvider';

const TICKS = [100, 500, 1000, 5000];
const usd2 = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Glides a number to its new value, so the figures roll as the slider moves.
function useGlide(target, ms = 420) {
  const [v, setV] = useState(target);
  const cur = useRef(target);
  useEffect(() => {
    if (typeof window === 'undefined') {
      cur.current = target;
      setV(target);
      return undefined;
    }
    const from = cur.current;
    const t0 = performance.now();
    let raf;
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      const x = from + (target - from) * (1 - Math.pow(1 - k, 3));
      cur.current = x;
      setV(x);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

export default function Calculator({ signedIn = false }) {
  const t = useT();
  const { data: cat } = useApi('/api/plans', { ttl: 60000 });
  const live = cat?.live || null;
  const best = cat?.smart || null;

  const [budget, setBudget] = useState('500'); // as typed
  const [term, setTerm] = useState(120);
  const [note, setNote] = useState(false); // the fine print under the button
  const artRef = useRef(null);
  const [seen, setSeen] = useState(true); // false while the miner picture is off screen, so its animations pause
  useEffect(() => {
    const el = artRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(([e]) => setSeen(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const est = smartEstimate(budget, term, cat?.smartTable); // the one formula for what a purchase pays (lib/smart.js)
  const b = est.budget;
  const perDay = est.perDay;
  const btcPx = live?.btc ?? BTC_USD;
  const rig = rigFor('smart');

  const usdShown = useGlide(perDay);
  const btcShown = useGlide(perDay / btcPx);
  const monthShown = useGlide(est.perMonth); // paid per month
  const termShown = useGlide(est.total); // total at term end

  if (cat?.smartOn === false) return null; // Smart Mining is switched off, so there is nothing to estimate

  const go = `/plans?plan=smart&budget=${b}&days=${term}`;

  return (
    <div className="calc">
      <div className="calc-l">
        <div className="calc-top">
          <span className="calc-lbl">{t('calc.earn')}</span>
          <span className="calc-live">
            <i className={best ? '' : 'off'} />
            {best ? t('calc.live', { coin: best.coin }) : t('calc.ref')}
          </span>
        </div>
        <div className="calc-main">
          <div ref={artRef} className={`calc-art${seen ? '' : ' off'}`}>
            <RigArt kind={rig.kind} units={rig.units} speed={rig.speed} id="calc" />
          </div>
          <div className="calc-nums" aria-live="off">
            <div className="calc-btc">
              {btcShown.toFixed(8)}
              <small>BTC / {t('calc.day')}</small>
            </div>
            <div className="calc-usd">≈ ${usd2(usdShown)} / {t('calc.day')}</div>
          </div>
        </div>
      </div>

      <div className="calc-r">
        <div className="slide">
          <div className="calc-th">
            <span>{t('calc.budget')}</span>
            <b>${b.toLocaleString('en-US')}</b>
          </div>
          <input
            type="range"
            min={SMART.min}
            max={SMART.max}
            step="50"
            value={b}
            aria-label={t('calc.budgetAria')}
            aria-valuetext={t('calc.dollars', { n: b })}
            style={{ '--p': `${((b - SMART.min) / (SMART.max - SMART.min)) * 100}%` }}
            onChange={(e) => setBudget(e.target.value)}
          />
          <div className="calc-ticks">
            {TICKS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => {
                  triggerHaptic('selection');
                  setBudget(String(v));
                }}
                aria-label={t('calc.setBudget', { n: v })}
              >
                ${v.toLocaleString('en-US')}
              </button>
            ))}
          </div>
          <div className="terms" role="group" aria-label={t('calc.term')}>
            {SMART.terms.map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={term === d}
                onClick={() => {
                  triggerHaptic('selection');
                  setTerm(d);
                }}
              >
                {t('calc.days', { d })}
              </button>
            ))}
          </div>
        </div>

        <div className="calc-grid">
          <div>
            <span>{t('calc.month')}</span>
            <b>~${usd2(monthShown)}</b>
          </div>
          <div>
            <span>{t('calc.total')}</span>
            <b>~${usd2(termShown)}</b>
          </div>
        </div>
        <p className="calc-hall">{t('calc.hall')}</p>

        {signedIn ? (
          <Link href={go} className="btn calc-go" onClick={() => triggerHaptic('light')}>
            {t('calc.open')}
          </Link>
        ) : (
          <AuthButton mode="signup" className="btn calc-go">
            {t('common.getStarted')}
          </AuthButton>
        )}
        <button type="button" className={`calc-more${note ? ' open' : ''}`} aria-expanded={note} aria-label={t('calc.about')} onClick={() => setNote((v) => !v)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
        </button>
        {note && (
          <p className="calc-fine">
            {fill(t('calc.fine'), { terms: <Link href="/terms">{t('auth.terms')}</Link> })}
          </p>
        )}
      </div>
    </div>
  );
}
