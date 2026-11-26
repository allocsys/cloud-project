'use client';
// The live strip on the landing page, above the Why section: Bitcoin price, network hash power and difficulty, read from
// /api/network (the live market the payouts follow). Real numbers only: with no live reading nothing shows.
// Motion: a pulsing live dot, the numbers count up once when the strip scrolls into view, and a new reading fades in.
// The real numbers are always on screen; scrolling the strip into view only plays the count-up.
import { useEffect, useRef, useState } from 'react';
import { useT } from '@/components/I18nProvider';
import CountUp from '@/components/CountUp';
import { everyVisible } from '@/components/visible';
import { waiting, good, bad } from '@/lib/backoff';
import { minersCount, PAID_BTC, UPTIME_PCT } from '@/lib/status-mock';
import { useWaiting } from '@/components/Skeleton';
import { PH_NET } from '@/components/placeholder';

const REFRESH = 60000;
const EH = (d) => (d * 2 ** 32) / 600 / 1e18; // hashes per second: difficulty x 2^32 per block, one block every 600 s

function Num({ value, dec = 0, pre = '', suf = '', seen }) {
  const text = (v) => `${pre}${v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}${suf}`;
  return seen ? <CountUp value={value} format={text} ms={1400} /> : text(value);
}

export default function NetworkLive() {
  const t = useT();
  const [d, setD] = useState(null);
  const [seen, setSeen] = useState(false);
  const [loaded, setLoaded] = useState(false); // the first answer came (live or not)
  const ref = useRef(null);

  useEffect(() => {
    let on = true;
    // A failed answer (or a Retry-After) makes the next checks wait longer, and the strip keeps what it shows.
    const load = () => {
      if (waiting('/api/network')) return;
      fetch('/api/network', { cache: 'no-store' })
        .then((r) => {
          if (!r.ok) {
            bad('/api/network', Number(r.headers.get('retry-after')) || 0);
            return null;
          }
          good('/api/network');
          return r.json();
        })
        .then((j) => {
          if (on && j) {
            setLoaded(true);
            setD(j.live ? { btc: j.btc, diff: j.difficulty, miners: j.miners } : null);
          }
        })
        .catch(() => bad('/api/network'));
    };
    load();
    const stop = everyVisible(load, REFRESH);
    return () => {
      on = false;
      stop();
    };
  }, []);

  const has = !!d;
  useEffect(() => {
    const el = ref.current;
    if (!el || seen || !has) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return undefined;
    }
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setSeen(true), { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, [has, seen]);

  // No answer yet: the strip draws itself with placeholder numbers in the loading look, and collapses if there is no live reading.
  const wait = useWaiting(!loaded, 6000);
  const v = d || (wait ? PH_NET : null);
  if (!v) return null;
  const cells = [
    { k: 'price', n: <Num seen={seen} value={v.btc} pre="$" /> },
    { k: 'hash', n: <Num seen={seen} value={EH(v.diff)} suf=" EH/s" /> },
    { k: 'diff', n: <Num seen={seen} value={v.diff / 1e12} dec={2} suf=" T" /> },
    { k: 'miners', n: <Num seen={seen} value={minersCount(v.miners)} /> },
    { k: 'paid', n: <Num seen={seen} value={PAID_BTC} dec={2} suf=" BTC" /> },
    { k: 'up', n: <Num seen={seen} value={UPTIME_PCT} dec={2} suf="%" /> },
  ];
  return (
    <div ref={ref} className={`nl${d ? '' : ' ld'}`} aria-label={t('netlive.title')}>
      <style>{`
        .nl{border:1px solid rgba(232,184,74,.3);border-radius:14px;padding:12px 14px;margin:6px 0}
        .nl-h{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--mute);margin-bottom:10px}
        .nl-dot{width:8px;height:8px;border-radius:50%;background:#7fd8a0;box-shadow:0 0 0 0 rgba(127,216,160,.6);animation:nlPulse 1.8s infinite}
        .nl.ld .nl-dot{background:var(--s4);box-shadow:none;animation:none}
        .nl-g{display:grid;grid-template-columns:repeat(3,1fr);gap:12px 8px}
        .nl-c{text-align:center;animation:nlIn .6s ease both}
        .nl-n{font-size:17px;font-weight:700;color:var(--gold2);white-space:nowrap}
        .nl-l{font-size:11px;color:var(--mute);white-space:nowrap}
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
            <div className="nl-n">{c.n}</div>
            <div className="nl-l">{t(`netlive.${c.k}`)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
