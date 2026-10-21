'use client';
// The two cards on the Buy tab: ASICs (fixed hash power) and Smart Mining. Each is one slider with its tiers marked along it;
// every tier has its own animation, and the picture swaps with a short fade when the slider crosses into a new tier.
import { useEffect, useRef } from 'react';
import RigArt, { rigFor } from '@/components/RigArt';
import { ASIC_TIERS, SMART_TIERS, tierOf } from '@/lib/tiers';
import { posFromTh } from '@/lib/reinvest';
import { fmtTh, fmtUsd, CUSTOM } from '@/lib/data';
import { SMART } from '@/lib/smart';
import { triggerHaptic } from '@/lib/haptics';

const GOLD = '#e9c46a';
const GOLD_LIGHT = '#f6dc9a';
const GREEN = '#7dd6a0';
const COINS = ['BTC', 'KAS', 'RVN', 'XMR'];
const ORBIT_S = [16, 11, 8, 5.5]; // seconds per turn, faster with each tier

// A small tick when the slider moves into another tier.
function useTierBuzz(id) {
  const prev = useRef(id);
  useEffect(() => {
    if (prev.current !== id) {
      prev.current = id;
      triggerHaptic('selection');
    }
  }, [id]);
}

// Smart Mining art. Four coins circle the hub and pass the marker at the top (today's pick). Higher tiers add an inner ring,
// floating coins and blinking lights. level is 1 to 4.
function SmartArt({ level, id }) {
  const gid = `sg${id}`;
  return (
    <div className="art" style={{ '--orb': `${ORBIT_S[level - 1]}s` }}>
      <svg viewBox="0 0 120 100" aria-hidden="true">
        <defs>
          <radialGradient id={gid}>
            <stop offset="0" stopColor={GOLD} stopOpacity=".5" />
            <stop offset="1" stopColor={GOLD} stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse className="glow" cx="60" cy="50" rx="56" ry="40" fill={`url(#${gid})`} />
        <g className="orbit">
          <circle cx="60" cy="50" r="32" fill="none" stroke={GOLD} strokeOpacity=".28" strokeDasharray="2 4" />
          {COINS.map((c, i) => {
            const a = (i * Math.PI) / 2;
            const x = +(60 + 32 * Math.cos(a)).toFixed(2);
            const y = +(50 + 32 * Math.sin(a)).toFixed(2);
            return (
              <g key={c} className="cn">
                <circle cx={x} cy={y} r="8.5" fill="#1d1a14" stroke={GOLD} strokeOpacity=".7" />
                <text x={x} y={y + 2.4} textAnchor="middle" fontSize="6.2" fontWeight="600" fill={GOLD_LIGHT}>{c}</text>
              </g>
            );
          })}
        </g>
        {level >= 2 && (
          <g className="orbit rev">
            <circle cx="60" cy="50" r="19" fill="none" stroke={GOLD} strokeOpacity=".2" />
            <circle cx="79" cy="50" r="1.9" fill={GREEN} />
            <circle cx="41" cy="50" r="1.9" fill={GOLD_LIGHT} />
          </g>
        )}
        {level >= 3 && [0, 1, 2].map((i) => (
          <circle key={i} className="coin" cx={46 + i * 14} cy="44" r="2.2" fill={GOLD_LIGHT} style={{ animationDelay: `${i * 0.9}s` }} />
        ))}
        {level >= 4 && [[14, 16], [106, 16], [14, 84], [106, 84]].map(([cx, cy], i) => (
          <circle key={i} className="led" cx={cx} cy={cy} r="1.7" fill={i % 2 ? GREEN : GOLD_LIGHT} style={{ animationDelay: `${i * 0.35}s` }} />
        ))}
        <circle className="hub" cx="60" cy="50" r="9" fill={GOLD} opacity=".92" />
        <path d="M55.5 50l3 3 6-6" stroke="#0e0d0a" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path className="pickmark" d="M60 7.5l-4.5-6.5h9z" fill={GREEN} />
      </svg>
    </div>
  );
}

function Ticks({ tiers, at, tier, label, onPick }) {
  const idx = tiers.indexOf(tier);
  return (
    <div className="ticks">
      {tiers.map((t, i) => (
        <button
          key={t.id}
          type="button"
          className="tick"
          data-on={i === idx}
          data-past={i < idx}
          style={{ '--t': at(t) }}
          aria-label={label(t)}
          onClick={() => {
            triggerHaptic('selection');
            onPick(t);
          }}
        />
      ))}
    </div>
  );
}

const stop = (e) => e.stopPropagation();

function TermChips({ terms, term, setTerm }) {
  return (
    <div className="terms" role="group" aria-label="Term">
      {terms.map((d) => (
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
  );
}

// plan is the priced custom plan (customPlan), daily the live estimate for it, hall the hall it runs in.
export function AsicsCard({ pos, setPos, term, setTerm, plan, daily, hall, within, onBuy }) {
  const tier = tierOf(ASIC_TIERS, plan.th);
  const rig = rigFor(tier.id);
  useTierBuzz(tier.id);
  return (
    <div className="card pcard">
      <div className="phead"><b>ASICs</b><span>{tier.name} · {fmtTh(plan.th)} TH/s</span></div>
      <div className="stage" key={tier.id}>
        <RigArt kind={rig.kind} units={rig.units} speed={rig.speed} id={`asic-${tier.id}`} />
      </div>
      <div className="slide">
        <div className="big"><b>{fmtTh(plan.th)} TH/s</b><span>~{daily}/day</span></div>
        <input
          type="range"
          min="0"
          max="1000"
          step="1"
          value={pos}
          aria-label="Hash power in terahash"
          aria-valuetext={`${fmtTh(plan.th)} terahash, ${tier.name}`}
          style={{ '--p': `${pos / 10}%` }}
          onChange={(e) => setPos(+e.target.value)}
          onTouchStart={stop}
          onTouchMove={stop}
          onTouchEnd={stop}
        />
        <Ticks
          tiers={ASIC_TIERS}
          tier={tier}
          at={(t) => posFromTh(t.from) / 1000}
          label={(t) => `${t.name}, from ${t.from} terahash`}
          onPick={(t) => setPos(posFromTh(t.from))}
        />
        <TermChips terms={CUSTOM.terms} term={term} setTerm={setTerm} />
      </div>
      <div className="prow">
        <div>
          <span>{hall ? hall.name : 'ASIC miners'}</span>
          <small>{hall ? `${hall.rig} · ${hall.efficiency}` : ''}</small>
        </div>
        <b>${fmtUsd(plan.price)}</b>
      </div>
      {within && <div className="tcan">✓ Within your balance</div>}
      <button type="button" className="btn" onClick={onBuy}>Buy ASICs</button>
    </div>
  );
}

// budget is the text in the amount box, bNum the budget it means; spos is the slider position (see lib/tiers.js).
export function SmartCard({ budget, bNum, spos, term, setTerm, plan, within, onAmount, onAmountBlur, onSlide, onBuy }) {
  const tier = tierOf(SMART_TIERS, bNum);
  const level = SMART_TIERS.indexOf(tier) + 1;
  useTierBuzz(tier.id);
  return (
    <div className="card pcard">
      <div className="phead"><b>Smart Mining</b><span>{tier.name} · best coin, daily</span></div>
      <div className="stage" key={tier.id}>
        <SmartArt level={level} id={tier.id} />
      </div>
      <div className="slide">
        <div className="big">
          <label className="amt">
            <i aria-hidden="true">$</i>
            <input
              type="number"
              inputMode="numeric"
              min={SMART.min}
              max={SMART.max}
              step="1"
              value={budget}
              aria-label={`Budget in dollars, ${SMART.min} to ${SMART.max.toLocaleString('en-US')}`}
              onChange={(e) => onAmount(e.target.value)}
              onBlur={onAmountBlur}
            />
          </label>
          <span>~{plan.daily}/day</span>
        </div>
        <input
          type="range"
          min="0"
          max="1000"
          step="1"
          value={spos}
          aria-label="Budget in dollars"
          aria-valuetext={`${bNum} dollars, ${tier.name}`}
          style={{ '--p': `${spos / 10}%` }}
          onChange={(e) => onSlide(+e.target.value)}
          onTouchStart={stop}
          onTouchMove={stop}
          onTouchEnd={stop}
        />
        <Ticks
          tiers={SMART_TIERS}
          tier={tier}
          at={(t) => spos0(t.from)}
          label={(t) => `${t.name}, from $${t.from}`}
          onPick={(t) => onSlide(spos0(t.from) * 1000)}
        />
        <TermChips terms={SMART.terms} term={term} setTerm={setTerm} />
      </div>
      <div className="prow">
        <div>
          <span>We pick the best coin every day</span>
          <small>Paid in BTC</small>
        </div>
        <b>${fmtUsd(plan.price)}</b>
      </div>
      {within && <div className="tcan">✓ Within your balance</div>}
      <button type="button" className="btn" onClick={onBuy}>Buy Smart Mining</button>
    </div>
  );
}

// 0 to 1 position of a budget on the Smart Mining slider.
import { posFromBudget } from '@/lib/tiers';
const spos0 = (budget) => posFromBudget(budget) / 1000;
