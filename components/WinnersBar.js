'use client';
// The rolling bar of the latest boost winners on the landing page, under the Boost card. It reads /api/boost/winners (masked name, prize and
// time only; empty while boost tickets are off, then nothing shows). Motion is one CSS transform on the strip, paused while off screen.
// There is no timer and no reduced-motion rule (owner's choice).
import { useEffect, useRef, useState } from 'react';
import { useApi } from '@/lib/api';
import { fill, useT } from '@/components/I18nProvider';

const whole = (n) => n.toLocaleString('en-US');

function ago(t, at, now) {
  const m = Math.max(1, Math.round((now - at) / 60000));
  if (m < 60) return t('ago.min', { n: m });
  const h = Math.floor(m / 60);
  return h < 24 ? t('ago.hour', { n: h }) : t('ago.day', { n: Math.floor(h / 24) });
}

export default function WinnersBar() {
  const t = useT();
  const { data } = useApi('/api/boost/winners', { ttl: 30000 });
  const ref = useRef(null);
  const [seen, setSeen] = useState(true);
  const list = data?.winners || [];
  const has = list.length > 0;
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(([e]) => setSeen(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, [has]);
  if (!has) return null;
  const now = Date.now();
  const items = list.map((w, i) => (
    <span key={i}>
      {fill(t('winners.won'), { name: w.name, prize: <b>${whole(w.prize)}</b> })} · {ago(t, w.at, now)}
    </span>
  ));

  return (
    <div ref={ref} className={`lp-marq lp-win${seen ? '' : ' off'}`} aria-label="Latest boost winners">
      <div className="lp-marq-in">
        <div className="lp-marq-g">{items}</div>
        <div className="lp-marq-g lp-marq-dup" aria-hidden="true">
          {items}
        </div>
      </div>
    </div>
  );
}
