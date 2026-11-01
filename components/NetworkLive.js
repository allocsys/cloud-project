'use client';
// The live strip on the landing page, above the Why section: Bitcoin price, network hash power and difficulty, read from
// /api/network (the live market the payouts follow). Real numbers only: with no live reading nothing shows.
// Motion: a pulsing live dot, the numbers count up once when the strip scrolls into view, and a new reading fades in.
import { useEffect, useRef, useState } from 'react';
import { useT } from '@/components/I18nProvider';
import { useCountUp } from '@/lib/useCountUp';

const REFRESH = 60000;
const EH = (d) => (d * 2 ** 32) / 600 / 1e18; // hashes per second: difficulty x 2^32 per block, one block every 600 s

function Num({ value, dec = 0, pre = '', suf = '' }) {
  const v = useCountUp(value, 1400);
  return (
    <>
      {pre}
      {v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}
      {suf}
    </>
  );
}

export default function NetworkLive() {
  const t = useT();
  const [d, setD] = useState(null);
  const [seen, setSeen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    let on = true;
    const load = () =>
      fetch('/api/network', { cache: 'no-store' })
        .then((r) => r.json())
        .then((j) => on && setD(j?.live ? { btc: j.btc, diff: j.difficulty } : null))
        .catch(() => {});
    load();
    const id = setInterval(load, REFRESH);
    return () => {
      on = false;
      clearInterval(id);
    };
  }, []);

  const has = !!d;
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return undefined;
    }
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setSeen(true), { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, [has, seen]);

  if (!d) return null;
  const cells = [
    { k: 'price', n: <Num value={d.btc} pre="$" /> },
    { k: 'hash', n: <Num value={EH(d.diff)} suf=" EH/s" /> },
    { k: 'diff', n: <Num value={d.diff / 1e12} dec={2} suf=" T" /> },
  ];
  return (
    <div ref={ref} className="nl" aria-label={t('netlive.title')}>
      <style>{`
        .nl{border:1px solid rgba(232,184,74,.3);border-radius:14px;padding:12px 14px;margin:6px 0}
        .nl-h{display:flex;align-items:center;gap:8px;font-size:13px;color:#a89868;margin-bottom:10px}
        .nl-dot{width:8px;height:8px;border-radius:50%;background:#7fd8a0;box-shadow:0 0 0 0 rgba(127,216,160,.6);animation:nlPulse 1.8s infinite}
        .nl-g{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
        .nl-c{text-align:center;animation:nlIn .6s ease both}
        .nl-n{font-size:17px;font-weight:700;color:#e8b84a;white-space:nowrap}
        .nl-l{font-size:11px;color:#a89868;white-space:nowrap}
        @keyframes nlPulse{0%{box-shadow:0 0 0 0 rgba(127,216,160,.6)}70%{box-shadow:0 0 0 8px rgba(127,216,160,0)}100%{box-shadow:0 0 0 0 rgba(127,216,160,0)}}
        @keyframes nlIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
      `}</style>
      <div className="nl-h">
        <span className="nl-dot" />
        {t('netlive.title')}
      </div>
      <div className="nl-g">
        {cells.map((c, i) => (
          <div className="nl-c" key={c.k} style={{ animationDelay: `${i * 120}ms` }}>
            <div className="nl-n">{seen ? c.n : '\u2014'}</div>
            <div className="nl-l">{t(`netlive.${c.k}`)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
