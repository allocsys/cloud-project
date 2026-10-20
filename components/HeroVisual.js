'use client';
import { useEffect, useState } from 'react';
import RigArt from '@/components/RigArt';

// The hero picture: an animated rig with a floating card. The card is a labelled demo, not a real account.
export default function HeroVisual() {
  const [v, setV] = useState(0.00184207);

  useEffect(() => {
    const t = setInterval(() => setV((x) => x + 0.00000006 + Math.random() * 0.00000004), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="lp-vis" aria-hidden="true">
      <div className="lp-vis-art">
        <RigArt kind="container" units={3} speed={0.8} id="hero" />
      </div>
      <div className="lp-float">
        <div className="lp-live">
          <i />
          Demo miner, live
        </div>
        <div className="lp-amt">
          {v.toFixed(8)}
          <small>BTC</small>
        </div>
        <div className="lp-eq">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <i key={i} style={{ animationDelay: `${i * 0.18}s` }} />
          ))}
        </div>
      </div>
    </div>
  );
}
