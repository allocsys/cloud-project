'use client';
// The earnings calculator on the page people see before they sign in.
// It uses the same numbers as the Plans screen: the live market from /api/plans (gross hashprice from BTC price and
// network difficulty), the hall's electricity and maintenance, and the custom-power price rule. With no live market it
// falls back to the catalogue's static rates and says so. Everything shown is an estimate, never a promise.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import RigArt, { rigFor } from '@/components/RigArt';
import { useApi } from '@/lib/api';
import { halls, CUSTOM, BTC_USD, customPlan, thFromPos, fmtTh } from '@/lib/data';
import { liveDaily } from '@/lib/market';
import { SLIDER_SIZES } from '@/lib/reinvest';
import { triggerHaptic } from '@/lib/haptics';

const TICKS = [1, 10, 100, 1000];
const posOf = (th) => Math.round((1000 * Math.log10(th)) / Math.log10(CUSTOM.max));
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
  const hallMap = cat?.halls || halls;
  const live = cat?.live || null;

  const [pos, setPos] = useState(667); // about 100 TH/s
  const [term, setTerm] = useState(180);

  const th = thFromPos(pos);
  const plan = customPlan(th, term, hallMap);
  const hall = hallMap[plan.hall];
  const perDay = liveDaily(th, hall, live) ?? th * hall.net;
  const btcPx = live?.btc ?? BTC_USD;
  const rig = rigFor({ th });

  const usdShown = useGlide(perDay);
  const btcShown = useGlide(perDay / btcPx);
  const monthShown = useGlide(perDay * 30);
  const termShown = useGlide(perDay * term);

  const go = signedIn
    ? `/plans?plan=custom${SLIDER_SIZES.includes(th) ? `&th=${th}` : ''}&days=${term}`
    : '/login?mode=signup';

  return (
    <div className="calc">
      <div className="calc-l">
        <div className="calc-top">
          <span className="calc-lbl">You could earn about</span>
          <span className="calc-live">
            <i className={live ? '' : 'off'} />
            {live ? `Live market · BTC $${Math.round(live.btc).toLocaleString('en-US')}` : 'Reference prices'}
          </span>
        </div>
        <div className="calc-main">
          <div className="calc-art">
            <RigArt key={`${rig.kind}${rig.units}`} kind={rig.kind} units={rig.units} speed={rig.speed} id="calc" />
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
            <span>with</span>
            <b>{fmtTh(th)} TH/s</b>
          </div>
          <input
            type="range"
            min="0"
            max="1000"
            step="1"
            value={pos}
            aria-label="Hash power in terahash"
            aria-valuetext={`${fmtTh(th)} terahash`}
            style={{ '--p': `${pos / 10}%` }}
            onChange={(e) => setPos(+e.target.value)}
          />
          <div className="calc-ticks">
            {TICKS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  triggerHaptic('selection');
                  setPos(posOf(t));
                }}
                aria-label={`Set to ${t} terahash`}
              >
                {t.toLocaleString('en-US')}
              </button>
            ))}
          </div>
          <div className="terms" role="group" aria-label="Term">
            {CUSTOM.terms.map((d) => (
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
            <b>~${usd2(termShown)}</b>
          </div>
          <div>
            <span>Price</span>
            <b>${usd2(plan.price)}</b>
          </div>
        </div>
        <p className="calc-hall">
          {hall.name}, {hall.place} · {hall.rig} · {hall.efficiency}
        </p>

        <Link href={go} className="btn" onClick={() => triggerHaptic('light')}>
          {signedIn ? 'Open this in Plans' : 'Get started'}
        </Link>
        <p className="calc-fine">
          An estimate at today&rsquo;s bitcoin price and network difficulty, after electricity and maintenance. It changes every day and is not a promise of
          earnings. See the <Link href="/terms">Terms</Link>.
        </p>
      </div>
    </div>
  );
}
