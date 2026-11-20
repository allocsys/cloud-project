'use client';
import { useEffect, useState } from 'react';

// Shimmering placeholders, shown only when a screen has no data at all yet (a first-ever start, nothing saved on the phone).
// Once any data has been seen, the saved copy fills the screen at once (lib/api.js) and these are not needed.
// Styles: .sk in app/globals.css.

// True while `pending` holds, but only for `ms`: if the answer never comes, the screen falls back to what it showed before
// instead of shimmering for ever.
export function useWaiting(pending, ms = 6000) {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!pending) {
      setLate(false);
      return undefined;
    }
    const t = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(t);
  }, [pending, ms]);
  return pending && !late;
}

// One shimmering block. w and h are CSS sizes (numbers are px); r overrides the corner radius.
export function Sk({ w = '100%', h = 14, r, style }) {
  return <i className="sk" aria-hidden="true" style={{ width: w, height: h, ...(r !== undefined ? { borderRadius: r } : null), ...style }} />;
}

// A card with a short heading and a few lines.
export function SkCard({ lines = 3, heading = true }) {
  return (
    <div className="card skc" aria-hidden="true">
      {heading && <Sk w="38%" h={16} />}
      {Array.from({ length: lines }).map((_, i) => (
        <Sk key={i} w={i === lines - 1 ? '62%' : '100%'} h={12} />
      ))}
    </div>
  );
}

// The big number card: a label, a big figure and four small figures.
export function SkHero() {
  return (
    <div className="card hero skc" aria-hidden="true">
      <Sk w="34%" h={12} />
      <Sk w="68%" h={38} r={10} />
      <Sk w="26%" h={12} />
      <div className="skrow">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skcol">
            <Sk w="70%" h={16} />
            <Sk w="50%" h={10} />
          </div>
        ))}
      </div>
    </div>
  );
}

// List rows (an icon, two lines and an amount), for activity and notification lists.
export function SkRows({ n = 3 }) {
  return (
    <div className="skc" aria-hidden="true" style={{ gap: 16, padding: '8px 0' }}>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Sk w={34} h={34} r="50%" />
          <div className="skc" style={{ flex: 1, gap: 8 }}>
            <Sk w="55%" h={13} />
            <Sk w="35%" h={10} />
          </div>
          <Sk w={64} h={13} />
        </div>
      ))}
    </div>
  );
}

// A pill in the tab bar, standing in for a tab whose presence is not known yet.
export function SkTab() {
  return <i className="sk sktab" aria-hidden="true" />;
}

// Buy plans before the catalogue: the Smart Mining card (dial, figures, term pills, button) and the ASICs card.
export function SkPlans() {
  return (
    <>
      <div className="card skc" aria-hidden="true">
        <Sk w="44%" h={18} />
        <Sk w="46%" h={150} r="50%" style={{ margin: '8px auto' }} />
        <div className="skrow" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <Sk w="60%" h={30} r={10} />
          <Sk w="60%" h={30} r={10} style={{ justifySelf: 'end' }} />
        </div>
        <Sk h={8} r={4} />
        <div className="skrow">
          {[0, 1, 2, 3].map((i) => (
            <Sk key={i} h={46} r={14} />
          ))}
        </div>
        <Sk h={50} r={25} />
      </div>
      <SkCard lines={3} />
    </>
  );
}

// My miners before the list: two miner cards.
export function SkMiners() {
  return (
    <div className="clist">
      {[0, 1].map((i) => (
        <div key={i} className="card skc" aria-hidden="true">
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <Sk w={54} h={54} r={12} />
            <div className="skc" style={{ flex: 1 }}>
              <Sk w="50%" h={16} />
              <Sk w="80%" h={12} />
            </div>
          </div>
          <Sk h={6} r={3} />
          <Sk w="70%" h={11} />
        </div>
      ))}
    </div>
  );
}

// Boost before its first answer.
export function SkBoost() {
  return <SkCard lines={5} />;
}

// The Earnings screen before its first data.
export function SkDash() {
  return (
    <>
      <SkHero />
      <SkCard lines={2} heading={false} />
      <div className="pair">
        <SkCard lines={2} />
        <SkCard lines={2} />
      </div>
    </>
  );
}
