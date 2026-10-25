'use client';
// The two cards on the Buy tab: ASICs (fixed hash power) and Smart Mining. Each is one slider with its tiers marked along it;
// every tier has its own animation, and the picture swaps with a short fade when the slider crosses into a new tier.
import { useEffect, useRef, useState } from 'react';
import RigArt, { rigFor } from '@/components/RigArt';
import { ASIC_TIERS, SMART_TIERS, tierOf, posFromBudget } from '@/lib/tiers';
import { posFromTh } from '@/lib/reinvest';
import { fmtTh, fmtUsd, CUSTOM } from '@/lib/data';
import { SMART, smartBand } from '@/lib/smart';
import { triggerHaptic } from '@/lib/haptics';
import { useT } from '@/components/I18nProvider';

const tierName = (t, tier) => t(`tier.${tier.id}`);

const AMBER = '#EF9F27';
const AMBER_L = '#FAC775';
const TEAL = '#5DCAA5';
const PURPLE = '#AFA9EC';
const COINS = ['BTC', 'KAS', 'RVN', 'XMR'];
// The four coins sit on the ring: top, right, bottom, left (x, y is the coin centre). px, py is where its first mining packet starts and
// dx, dy the way that packet travels to the hub.
const SPOTS = [
  { x: 160, y: 48, px: 160, py: 68, dx: 0, dy: 40 },
  { x: 242, y: 130, px: 222, py: 130, dx: -40, dy: 0 },
  { x: 160, y: 212, px: 160, py: 192, dx: 0, dy: -40 },
  { x: 78, y: 130, px: 98, py: 130, dx: 40, dy: 0 },
];
const RAYS = [[160, 105, 160, 98], [160, 155, 160, 162], [135, 130, 128, 130], [185, 130, 192, 130], [142, 112, 137, 107], [178, 112, 183, 107], [142, 148, 137, 153], [178, 148, 183, 153]];
const LEDS = [[22, 22, AMBER_L, 0], [298, 22, TEAL, 0.35], [22, 238, TEAL, 0.7], [298, 238, AMBER_L, 1.05]];

// Smart Mining art, all CSS transform and opacity (no timers). A scanner sweeps the four coins and flashes each as it passes; every 8 s
// the green marker hops to the next coin (the day's pick), mining packets flow from it into the hub, and a bitcoin bubble floats out.
// The scanner speeds up with each tier (--sw). Tier 2 adds the inner ring, a second ripple and the bubble; tier 3 small coins and a glow;
// tier 4 blinking lights and rays. Paused while off screen. No reduced-motion rule (owner's choice).
const ART_CSS = `
.sart{--sw:5s}
.sart[data-lv="2"]{--sw:4s}
.sart[data-lv="3"]{--sw:3.2s}
.sart[data-lv="4"]{--sw:2.6s}
.pcard .stage .art svg.sa-svg{height:200px}
.sart[data-lv="1"] .sa-l2,.sart[data-lv="1"] .sa-l3,.sart[data-lv="1"] .sa-l4,.sart[data-lv="2"] .sa-l3,.sart[data-lv="2"] .sa-l4,.sart[data-lv="3"] .sa-l4{display:none}
.sa-o{transform-origin:160px 130px}
.sa-spin{animation:saSp var(--sw) linear infinite}
.sa-ring{animation:saSp 40s linear infinite}
.sa-rev{animation:saSp 9s linear infinite reverse}
@keyframes saSp{to{transform:rotate(360deg)}}
.sa-fl{opacity:0;animation:saFl var(--sw) linear infinite;animation-delay:calc(var(--sw)*.25*var(--i))}
@keyframes saFl{0%{opacity:0}3%{opacity:1}16%,100%{opacity:0}}
.sa-slot{opacity:0;animation:saSlot 32s linear infinite;animation-delay:calc(var(--i)*8s)}
@keyframes saSlot{0%{opacity:0}2%,22%{opacity:1}25%,100%{opacity:0}}
.sa-pk{transform-box:fill-box;transform-origin:center;animation:saPk 1.6s ease-in-out infinite}
@keyframes saPk{0%,100%{transform:scale(1)}50%{transform:scale(1.1)}}
.sa-pkt{opacity:0;animation:saPt 1.1s linear infinite}
@keyframes saPt{0%{opacity:0;transform:translate(0,0)}20%,80%{opacity:1}100%{opacity:0;transform:translate(var(--dx),var(--dy))}}
.sa-ptr{animation:saPtr 32s ease-in-out infinite}
@keyframes saPtr{0%,21%{transform:rotate(0)}25%,46%{transform:rotate(90deg)}50%,71%{transform:rotate(180deg)}75%,96%{transform:rotate(270deg)}100%{transform:rotate(360deg)}}
.sa-rip{opacity:0;animation:saRip 2.4s ease-out infinite}
@keyframes saRip{0%{opacity:.55;transform:scale(1)}100%{opacity:0;transform:scale(2.5)}}
.sa-mc{opacity:0;animation:saFloat 2.6s ease-out infinite}
@keyframes saFloat{0%{opacity:0;transform:translateY(0)}25%{opacity:1}100%{opacity:0;transform:translateY(-34px)}}
.sa-bub{opacity:0;animation:saBub 8s ease-out infinite;animation-delay:1s}
@keyframes saBub{0%,58%{opacity:0;transform:translate(0,0) scale(.5)}66%{opacity:1;transform:translate(8px,-8px) scale(1)}84%{opacity:1;transform:translate(36px,-36px) scale(1.12)}92%,100%{opacity:0;transform:translate(40px,-40px) scale(1.12)}}
.sa-ray{opacity:0;animation:saRay 8s ease-out infinite;animation-delay:1s}
@keyframes saRay{0%,66%{opacity:0;transform:scale(.5)}74%{opacity:1;transform:scale(1)}86%,100%{opacity:0;transform:scale(1.3)}}
.sa-glow{opacity:.08;animation:saGl 3s ease-in-out infinite}
@keyframes saGl{0%,100%{opacity:.06;transform:scale(1)}50%{opacity:.16;transform:scale(1.08)}}
.sa-led{animation:saLed 1.4s ease-in-out infinite}
@keyframes saLed{0%,100%{opacity:.2}50%{opacity:1}}
.sart.off *{animation-play-state:paused!important}
`;

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

// level is 1 to 4.
function SmartArt({ level }) {
  const ref = useRef(null);
  const [seen, setSeen] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(([e]) => setSeen(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`art sart${seen ? '' : ' off'}`} data-lv={level}>
      <style>{ART_CSS}</style>
      <svg className="sa-svg" viewBox="0 0 320 260" aria-hidden="true">
        <circle className="sa-o sa-glow sa-l3" cx="160" cy="130" r="64" fill={AMBER} />
        <g className="sa-o sa-ring">
          <circle cx="160" cy="130" r="82" fill="none" stroke={AMBER} strokeOpacity=".35" strokeDasharray="2 5" />
        </g>
        <g className="sa-o sa-rev sa-l2">
          <circle cx="160" cy="130" r="38" fill="none" stroke={AMBER} strokeOpacity=".3" />
          <circle cx="198" cy="130" r="3" fill={TEAL} />
          <circle cx="122" cy="130" r="3" fill={AMBER} />
        </g>
        <g className="sa-o sa-spin">
          <path d="M160 130L160 48A82 82 0 0 0 102 72Z" fill={AMBER} fillOpacity=".10" />
          <path d="M160 130L160 48A82 82 0 0 0 140.2 50.4Z" fill={AMBER} fillOpacity=".22" />
          <line x1="160" y1="130" x2="160" y2="48" stroke={AMBER} strokeWidth="1.5" strokeOpacity=".8" />
        </g>
        {SPOTS.map((s, i) => (
          <g key={COINS[i]} className="sa-slot" style={{ '--i': i }}>
            <circle className="sa-pk" cx={s.x} cy={s.y} r="21" fill="none" stroke={TEAL} strokeWidth="2" />
            {[0, 1, 2].map((k) => (
              <circle key={k} className="sa-pkt" cx={s.px} cy={s.py} r="2.8" fill={AMBER} style={{ '--dx': `${s.dx}px`, '--dy': `${s.dy}px`, animationDelay: `${k * 0.37}s` }} />
            ))}
          </g>
        ))}
        {SPOTS.map((s, i) => (
          <g key={COINS[i]}>
            <circle cx={s.x} cy={s.y} r="17" fill="var(--s2)" stroke={AMBER} strokeOpacity=".8" />
            <text x={s.x} y={s.y + 4} textAnchor="middle" fontSize="11" fontWeight="500" fill="var(--text)">{COINS[i]}</text>
            <circle className="sa-fl" style={{ '--i': i }} cx={s.x} cy={s.y} r="17" fill="none" stroke={TEAL} strokeWidth="2" />
          </g>
        ))}
        <g className="sa-o sa-ptr">
          <path d="M160 29l-5-9h10z" fill={TEAL} />
        </g>
        <circle className="sa-o sa-rip" cx="160" cy="130" r="24" fill="none" stroke={AMBER} strokeWidth="1.5" />
        <circle className="sa-o sa-rip sa-l2" cx="160" cy="130" r="24" fill="none" stroke={AMBER} strokeWidth="1.5" style={{ animationDelay: '1.2s' }} />
        <circle cx="160" cy="130" r="22" fill={AMBER} />
        <path d="M153 130l5 5 10-10" stroke="#412402" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {[[136, 118, 0], [184, 118, 0.87], [176, 104, 1.73]].map(([cx, cy, d]) => (
          <circle key={cx} className="sa-mc sa-l3" cx={cx} cy={cy} r="3" fill={AMBER_L} style={{ animationDelay: `${d}s` }} />
        ))}
        <g className="sa-o sa-bub sa-l2">
          <g className="sa-o sa-ray sa-l4" stroke={PURPLE} strokeWidth="2" strokeLinecap="round">
            {RAYS.map(([x1, y1, x2, y2]) => (
              <line key={`${x1}${y1}`} x1={x1} y1={y1} x2={x2} y2={y2} />
            ))}
          </g>
          <circle cx="160" cy="130" r="12" fill={AMBER} fillOpacity=".25" stroke={AMBER} strokeWidth="1.2" />
          <text x="160" y="135" textAnchor="middle" fontSize="14" fontWeight="500" fill="var(--text)">₿</text>
        </g>
        {LEDS.map(([cx, cy, c, d]) => (
          <circle key={cx + cy} className="sa-led sa-l4" cx={cx} cy={cy} r="3" fill={c} style={{ animationDelay: `${d}s` }} />
        ))}
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
  const t = useT();
  return (
    <div className="terms" role="group" aria-label={t('calc.term')}>
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
          {t('calc.days', { d })}
        </button>
      ))}
    </div>
  );
}

// plan is the priced custom plan (customPlan), daily the live estimate for it, hall the hall it runs in.
export function AsicsCard({ pos, setPos, term, setTerm, plan, daily, hall, within, onBuy }) {
  const t = useT();
  const tier = tierOf(ASIC_TIERS, plan.th);
  const rig = rigFor(tier.id);
  useTierBuzz(tier.id);
  return (
    <div className="card pcard">
      <div className="phead"><b>ASICs</b><span>{tierName(t, tier)} · {fmtTh(plan.th)} TH/s</span></div>
      <div className="stage" key={tier.id}>
        <RigArt kind={rig.kind} units={rig.units} speed={rig.speed} id={`asic-${tier.id}`} />
      </div>
      <div className="slide">
        <div className="big"><b>{fmtTh(plan.th)} TH/s</b><span>~{daily}/{t('calc.day')}</span>
        </div>
        <input
          type="range"
          min="0"
          max="1000"
          step="1"
          value={pos}
          aria-label={t('pc.hashAria')}
          aria-valuetext={t('pc.hashText', { th: fmtTh(plan.th), tier: tierName(t, tier) })}
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
          label={(x) => t('pc.tickTh', { tier: tierName(t, x), from: x.from })}
          onPick={(t) => setPos(posFromTh(t.from))}
        />
        <TermChips terms={CUSTOM.terms} term={term} setTerm={setTerm} />
      </div>
      <div className="prow">
        <div>
          <span>{hall ? hall.name : t('pc.asicMiners')}</span>
          <small>{hall ? `${hall.rig} · ${hall.efficiency}` : ''}</small>
        </div>
        <b>${fmtUsd(plan.price)}</b>
      </div>
      {within && <div className="tcan">{t('pc.within')}</div>}
      <button type="button" className="btn" onClick={onBuy}>{t('pc.buyAsics')}</button>
    </div>
  );
}

// budget is the text in the amount box, bNum the budget it means; spos is the slider position (see lib/tiers.js).
export function SmartCard({ budget, bNum, spos, term, setTerm, plan, within, onAmount, onAmountBlur, onSlide, onBuy }) {
  const t = useT();
  const tier = tierOf(SMART_TIERS, bNum);
  const level = SMART_TIERS.indexOf(tier) + 1;
  const band = smartBand(plan); // profit range for the term (lib/smart.js)
  useTierBuzz(tier.id);
  return (
    <div className="card pcard">
      <div className="phead"><b>{t('dash.smart')}</b><span>{tierName(t, tier)} · {t('pc.bestDaily')}</span></div>
      <div className="stage" key={tier.id}>
        <SmartArt level={level} />
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
              aria-label={t('pc.budgetRange', { a: SMART.min, b: SMART.max.toLocaleString('en-US') })}
              onChange={(e) => onAmount(e.target.value)}
              onBlur={onAmountBlur}
            />
          </label>
          <span>~{plan.daily}/{t('calc.day')}</span>
        </div>
        <input
          type="range"
          min="0"
          max="1000"
          step="1"
          value={spos}
          aria-label={t('calc.budgetAria')}
          aria-valuetext={t('pc.dollarsTier', { n: bNum, tier: tierName(t, tier) })}
          style={{ '--p': `${spos / 10}%` }}
          onChange={(e) => onSlide(+e.target.value)}
          onTouchStart={stop}
          onTouchMove={stop}
          onTouchEnd={stop}
        />
        <Ticks
          tiers={SMART_TIERS}
          tier={tier}
          at={(t) => posFromBudget(t.from) / 1000}
          label={(x) => t('pc.tickUsd', { tier: tierName(t, x), from: x.from })}
          onPick={(t) => onSlide(posFromBudget(t.from))}
        />
        <TermChips terms={SMART.terms} term={term} setTerm={setTerm} />
      </div>
      <div className="prow">
        <div>
          <span>{t('pc.pick')}</span>
          <small>{t('pc.paidBtc')}</small>
        </div>
        <b>${fmtUsd(plan.price)}</b>
      </div>
      {band && (
        <div className="tcan">
          {t('pc.bandLine', { mid: fmtUsd(band.mid), d: plan.days, low: fmtUsd(band.low), high: fmtUsd(band.high) })}
        </div>
      )}
      {within && <div className="tcan">{t('pc.within')}</div>}
      <button type="button" className="btn" onClick={onBuy}>{t('pc.buySmart')}</button>
    </div>
  );
}
