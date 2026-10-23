'use client';
// The earnings calculator on the page people see before they sign in.
// It works from a budget and a term, like the Smart Mining sheet on the Plans screen (lib/smart.js): the estimate is the
// budget x the pay table's payout x days, the middle of the 70%-130% band, the same estimate as the buy sheet. The live coin
// only shows in the badge and does not scale the numbers. Everything shown is an estimate, never a promise.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import RigArt, { rigFor } from '@/components/RigArt';
import { useApi } from '@/lib/api';
import { BTC_USD } from '@/lib/data';
import { SMART, smartPayout } from '@/lib/smart';
import { triggerHaptic } from '@/lib/haptics';

const TICKS = [100, 500, 1000, 5000];
const usd2 = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Glides a number to its new value, so the figures roll as the slider moves. Reduced motion jumps straight to it.
function useGlide(target, ms = 420) {
  const [v, setV] = useState(target);
  const cur = useRef(target);
  useEffect(() => {
    if (typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
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
  const { data: cat } = useApi('/api/plans', { ttl: 60000 });
  const live = cat?.live || null;
  const best = cat?.smart || null;

  const [budget, setBudget] = useState('500'); // as typed
  const [term, setTerm] = useState(120);

  const b = Math.min(SMART.max, Math.max(SMART.min, Math.round(Number(budget)) || SMART.min));
  const profit = b * smartPayout(b, term, cat?.smartTable) * term; // middle of the band
  const perDay = profit / term;
  const lo = profit * (1 - SMART.bandShare);
  const hi = profit * (1 + SMART.bandShare);
  const btcPx = live?.btc ?? BTC_USD;
  const rig = rigFor('smart');

  const usdShown = useGlide(perDay);
  const btcShown = useGlide(perDay / btcPx);
  const monthShown = useGlide(perDay * 30);
  const termShown = useGlide(perDay * term);

  if (cat?.smartOn === false) return null; // Smart Mining is switched off, so there is nothing to estimate

  const go = signedIn ? `/plans?plan=smart&budget=${b}&days=${term}` : '/login?mode=signup';

  return (
    <div className="calc">
      <div className="calc-l">
        <div className="calc-top">
          <span className="calc-lbl">You could earn about</span>
          <span className="calc-live">
            <i className={best ? '' : 'off'} />
            {best ? `Live market · mining ${best.coin} today` : 'Reference prices'}
          </span>
        </div>
        <div className="calc-main">
          <div className="calc-art">
            <RigArt kind={rig.kind} units={rig.units} speed={rig.speed} id="calc" />
          </div>
          <div className="calc-nums" aria-live="off">
            <div className="calc-btc">
              {btcShown.toFixed(8)}
              <small>BTC / day</small>
            </div>
            <div className="calc-usd">≈ ${usd2(usdShown)} / day</div>
          </div>
        </div>
      </div>

      <div className="calc-r">
        <div className="slide">
          <div className="calc-th">
            <span>with a budget of</span>
            <b>${b.toLocaleString('en-US')}</b>
          </div>
          <input
            type="range"
            min={SMART.min}
            max={SMART.max}
            step="50"
            value={b}
            aria-label="Budget in dollars"
            aria-valuetext={`${b} dollars`}
            style={{ '--p': `${((b - SMART.min) / (SMART.max - SMART.min)) * 100}%` }}
            onChange={(e) => setBudget(e.target.value)}
          />
          <div className="calc-ticks">
            {TICKS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  triggerHaptic('selection');
                  setBudget(String(t));
                }}
                aria-label={`Set budget to ${t} dollars`}
              >
                ${t.toLocaleString('en-US')}
              </button>
            ))}
          </div>
          <div className="terms" role="group" aria-label="Term">
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
                {d} days
              </button>
            ))}
          </div>
        </div>

        <div className="calc-grid">
          <div>
            <span>Per month</span>
            <b>~${usd2(monthShown)}</b>
          </div>
          <div>
            <span>Over {term} days</span>
            <b>About ${usd2(termShown)}<small>Between ${usd2(lo)} and ${usd2(hi)}</small></b>
          </div>
          <div>
            <span>Price</span>
            <b>${usd2(b)}</b>
          </div>
        </div>
        <p className="calc-hall">We pick the most profitable coin for you every day · Paid in BTC</p>

        <Link href={go} className="btn calc-go" onClick={() => triggerHaptic('light')}>
          {signedIn ? 'Open this in Plans' : 'Get started'}
        </Link>
        <p className="calc-fine">
          An estimate of your profit after electricity and maintenance. It can come in lower or higher and is not a promise of earnings. See the{' '}
          <Link href="/terms">Terms</Link>.
        </p>
      </div>
    </div>
  );
}
