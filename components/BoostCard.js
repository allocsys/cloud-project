'use client';
import { useEffect, useRef, useState } from 'react';
import { useApi, post, revalidate } from '@/lib/api';
import { triggerHaptic } from '@/lib/haptics';
import { useT } from '@/components/I18nProvider';
import { PH_BOOST } from '@/lib/placeholder';
import { BUY_QTY } from '@/lib/boost';

// Boost tickets on the Plans page: a ticket starts a 2 hour boost of extra hashrate with a prize draw. Rules in lib/boost.js, server in
// lib/server/boost.js. Every purchase is its own boost, drawn as a wedge in a 20 slot dial (the fill grows outward as it runs). The draw shows when the boost ends.
// A ticket is paid from the balance. Tap Buy $X and three bubbles (x1, x3, x5) fly out above the button; tapping a bubble buys that many at once
// (one request with qty). A held free ticket keeps its one tap button and has no bubbles.

const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const usd = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const whole = (n) => n.toLocaleString('en-US');

// Buy bubbles: size, sideways spread (DX), top of each bubble above the button row (TOP, from the top of the fan) and the height of the fan (LIFT).
// Animations are always on, no reduced motion rule (owner's choice). Colours are the dial tier colours.
const BUB = 58;
const DX = [-66, 0, 66];
const TOP = [56, 22, 56];
const LIFT = 126;
const BTN_MID = 22; // half the height of a buy button
const bubRgb = (price) => (price >= 100 ? '175,169,236' : price >= 10 ? '93,202,165' : '245,165,36');
const BUB_CSS =
  'button.bbl{position:absolute;z-index:3;width:58px;height:58px;min-width:0;min-height:0;padding:0;margin:0;border:0!important;outline:none!important;box-shadow:none!important;background:transparent!important;-webkit-appearance:none;appearance:none;border-radius:50%;opacity:0;animation:bpop .62s cubic-bezier(.2,.9,.3,1.25) forwards;animation-delay:calc(var(--k)*80ms);cursor:pointer;-webkit-tap-highlight-color:transparent}' +
  'button.bbl:hover,button.bbl:active,button.bbl:focus{background:transparent!important;transform:none;border:0!important;outline:none!important;box-shadow:none!important}' +
  '.bbl-in{position:absolute;inset:0;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.1;color:#fff;border:1.5px solid rgba(var(--c),.8);background:radial-gradient(circle at 50% 58%,rgba(var(--c),.06) 38%,rgba(var(--c),.42) 100%);box-shadow:inset 0 0 14px rgba(var(--c),.5),0 0 16px rgba(var(--c),.28);animation:bbob 2.6s ease-in-out infinite;animation-delay:calc(var(--k)*-.7s)}' +
  ".bbl-in::before{content:'';position:absolute;left:10px;top:7px;width:20px;height:11px;border-radius:50%;background:rgba(255,255,255,.7);transform:rotate(-32deg)}" +
  ".bbl-in::after{content:'';position:absolute;right:11px;bottom:9px;width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.4)}" +
  '.bbl b{font-size:17px;font-weight:500;position:relative}' +
  '.bbl small{font-size:11px;color:rgba(255,255,255,.75);position:relative}' +
  ".bbl[data-off='1'] .bbl-in{animation:none;filter:saturate(.2);opacity:.5;border-style:dashed}" +
  'button.bbl.bbl-gone{animation:bgone .3s ease-in forwards}' +
  '@keyframes bpop{0%{opacity:0;transform:translate(var(--sx),var(--sy)) scale(.15)}55%{opacity:1;transform:translate(0,-8px) scale(1.2,.88)}75%{transform:translate(0,2px) scale(.94,1.07)}100%{opacity:1;transform:translate(0,0) scale(1)}}' +
  '@keyframes bbob{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-5px) scale(1.04,.97)}}' +
  '@keyframes bgone{from{opacity:1;transform:translate(0,0) scale(1)}to{opacity:0;transform:translate(var(--sx),var(--sy)) scale(.1)}}';

// One burst piece on a bubble (ring, droplet, label): starts invisible, the caller animates it.
function mk(bb, css) {
  const s = document.createElement('span');
  s.style.cssText = `position:absolute;pointer-events:none;opacity:0;${css}`;
  bb.appendChild(s);
  return s;
}

// The pop on a bought bubble: squish, big swell, two rings, 14 droplets and a floating label (about 1.1 s). The bubble is removed afterwards by React.
function pop(bb, c, label) {
  const inn = bb.querySelector('.bbl-in');
  if (!inn || !inn.animate) return;
  inn.style.animation = 'none';
  inn.animate(
    [
      { transform: 'scale(1)', opacity: 1 },
      { transform: 'scale(.8)', opacity: 1, offset: 0.28 },
      { transform: 'scale(1.45)', opacity: 1, offset: 0.7 },
      { transform: 'scale(1.6)', opacity: 0 },
    ],
    { duration: 340, easing: 'ease-out', fill: 'forwards' },
  );
  [0, 1].forEach((n) => {
    const rg = mk(bb, `left:0;top:0;right:0;bottom:0;border-radius:50%;border:${3 - n}px solid rgb(${c})`);
    rg.animate([{ opacity: 0.95, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(2.8)' }], { duration: 560, delay: 220 + n * 90, easing: 'ease-out', fill: 'forwards' });
  });
  for (let k = 0; k < 14; k++) {
    const a = ((k * 360) / 14 + Math.random() * 18) * (Math.PI / 180);
    const d = 46 + Math.random() * 34;
    const z = 4 + Math.random() * 5;
    const dr = mk(bb, `left:50%;top:50%;width:${z}px;height:${z}px;margin:-${z / 2}px 0 0 -${z / 2}px;border-radius:50%;background:rgb(${c})`);
    dr.animate(
      [
        { opacity: 1, transform: 'translate(0,0) scale(1)' },
        { opacity: 0, transform: `translate(${Math.round(Math.cos(a) * d)}px,${Math.round(Math.sin(a) * d)}px) scale(.2)` },
      ],
      { duration: 650, delay: 220, easing: 'cubic-bezier(.1,.7,.3,1)', fill: 'forwards' },
    );
  }
  const tx = mk(bb, `left:50%;top:-6px;transform:translateX(-50%);white-space:nowrap;font-size:15px;font-weight:500;color:rgb(${c})`);
  tx.textContent = label;
  tx.animate(
    [
      { opacity: 0, transform: 'translate(-50%,0)' },
      { opacity: 1, transform: 'translate(-50%,-14px)', offset: 0.3 },
      { opacity: 0, transform: 'translate(-50%,-40px)' },
    ],
    { duration: 800, delay: 260, easing: 'ease-out', fill: 'forwards' },
  );
}

// Time left as text: under a minute, minutes, or hours and minutes.
function left(t, ms) {
  const m = Math.ceil(ms / 60000);
  if (m <= 1) return t('bst.under');
  return m >= 60 ? t('bst.hm', { h: Math.floor(m / 60), m: m % 60 }) : t('bst.m', { m });
}

// Wedge dial: 20 fixed slots of 18 degrees, inner radius R1, outer R2. Colour and rim thickness show the tier.
const SLOTS = 20;
const R1 = 46;
const R2 = 138;
const tier = (price) => (price >= 100 ? { c: '#AFA9EC', w: 5 } : price >= 10 ? { c: '#5DCAA5', w: 4 } : { c: '#F5A524', w: 3 });
const pt = (r, d) => {
  const a = ((d - 90) * Math.PI) / 180;
  return [150 + r * Math.cos(a), 150 + r * Math.sin(a)];
};
const xy = (p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
const wedge = (r1, r2, a1, a2) => `M${xy(pt(r2, a1))}A${r2} ${r2} 0 0 1 ${xy(pt(r2, a2))}L${xy(pt(r1, a2))}A${r1} ${r1} 0 0 0 ${xy(pt(r1, a1))}Z`;
const rim = (r, a1, a2) => `M${xy(pt(r, a1))}A${r} ${r} 0 0 1 ${xy(pt(r, a2))}`;

export default function BoostCard({ show, loading = false }) {
  const t = useT();
  const { data: answer, refresh } = useApi('/api/boost', { ttl: 10000 });
  // While the first answer is on its way the card draws itself with placeholder tickets in the loading look (lib/placeholder.js, .ld).
  const ph = !answer && loading;
  const data = answer || (ph ? PH_BOOST : undefined);
  const [now, setNow] = useState(() => Date.now());
  const [fan, setFan] = useState(null); // the ticket whose buy bubbles are out: { id, from (centre of its button), cx (centre of the fan), act (boosts running when it opened) }
  const [out, setOut] = useState(false); // the bubbles are shrinking back
  const [picked, setPicked] = useState(null); // the bubble (1, 3 or 5) being bought: the others shrink back
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState(null); // id of the boost picked on the dial
  const slotMap = useRef(new Map()); // boost id -> slot, so a wedge never moves when another boost ends
  const skew = useRef(0); // server clock minus this device's clock
  const buyKey = useRef(null); // { sig, k }: key of the bubble buy in progress: kept until it goes through, so a retry after a lost answer is not a second buy
  const freeKey = useRef(null); // key of the free ticket tap in progress: kept until it goes through, so a retry after a lost answer is not a second ticket
  const closeTimer = useRef(null);
  const dialRef = useRef(null);
  const btnRef = useRef(null);
  const [btnSeen, setBtnSeen] = useState(true); // the free ticket pulse pauses while the buttons are off-screen
  const [seen, setSeen] = useState(true); // the dial animations pause while it is off-screen
  const [aq, setAq] = useState(null); // tickets a day picked for auto buy (null = the saved amount)
  const [autoBusy, setAutoBusy] = useState(false);

  useEffect(() => {
    if (data?.now) skew.current = data.now - Date.now();
  }, [data]);

  // Ticks every few seconds so the dial and the time left move; when a boost has ended, ask the server for its result.
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now() + skew.current), 5000);
    return () => clearInterval(iv);
  }, []);
  const running = data?.running || [];
  const ended = running.some((b) => now >= b.endsAt);
  useEffect(() => {
    if (!ended) return;
    refresh().catch(() => {});
    revalidate('/api/wallet').catch(() => {});
  }, [ended]);
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  // A tap outside the buttons shrinks the bubbles back (a tap inside the row is handled by the buttons and bubbles themselves).
  useEffect(() => {
    if (!fan || out || busy) return undefined;
    const away = (e) => {
      if (!btnRef.current?.contains(e.target)) closeFan();
    };
    document.addEventListener('click', away);
    return () => document.removeEventListener('click', away);
  }, [fan, out, busy]);
  const hasDial = (data?.running?.length || 0) > 0;
  useEffect(() => {
    const el = dialRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(([e]) => setSeen(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, [hasDial]);
  const freeN = data?.free || 0; // free tickets waiting to be used
  useEffect(() => {
    const el = btnRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(([e]) => setBtnSeen(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, [freeN > 0, data?.enabled]);

  if (!data) return null;

  // The bubbles shrink back, then go.
  function closeFan() {
    if (!fan) return;
    setOut(true);
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      setFan(null);
      setOut(false);
    }, 320);
  }

  // Auto buy: turns it on with `qty` $1 tickets a day, or off (server: lib/server/boost.js setAutoBoost). Picking another amount while it is on saves it at once.
  async function saveAuto(on, qty) {
    if (autoBusy) return;
    setAutoBusy(true);
    try {
      await post('/api/boost/auto', { on, qty });
      await refresh().catch(() => {});
      triggerHaptic('success');
      show(t(on ? 'bst.autoSaved' : 'bst.autoStopped'));
    } catch (e) {
      triggerHaptic('error');
      show(e.status ? e.message : t('common.noConnection'));
    } finally {
      setAutoBusy(false);
    }
  }

  // A held free ticket: one tap, nothing to pay, no bubbles.
  async function spendFree() {
    if (busy) return;
    closeFan();
    setBusy(true);
    try {
      if (!freeKey.current) freeKey.current = uid();
      await post('/api/boost', { free: true }, freeKey.current);
      freeKey.current = null;
      await refresh().catch(() => {});
      triggerHaptic('success');
      show(t('bst.started'));
    } catch (e) {
      triggerHaptic('error');
      show(e.status ? e.message : t('common.noConnection'));
    } finally {
      setBusy(false);
      revalidate('/api/wallet').catch(() => {});
    }
  }

  // Tap Buy $X: the bubbles fly out above that button, in a fan kept inside the row. The same button again shrinks them back.
  function toggle(tk, e) {
    if (busy || out) return;
    if (fan?.id === tk.id) {
      closeFan();
      return;
    }
    triggerHaptic('selection');
    clearTimeout(closeTimer.current);
    const cell = e.currentTarget.parentElement; // the box of this button inside the row
    const half = DX[2] + BUB / 2;
    const from = cell.offsetLeft + cell.offsetWidth / 2;
    setPicked(null);
    setFan({ id: tk.id, from, cx: Math.max(half, Math.min(cell.parentElement.clientWidth - half, from)), act: tk.active });
  }

  // Tap a bubble: buys that many at once (one request). A greyed bubble only says why not.
  async function buyQ(tk, q, e) {
    if (busy || out || !fan) return;
    if (fan.act + q > tk.max) {
      show(t('bst.limit', { n: tk.max }));
      return;
    }
    const bb = e.currentTarget;
    const inn = bb.querySelector('.bbl-in');
    if (inn) {
      inn.style.animation = 'none';
      inn.style.transition = 'transform .12s';
      inn.style.transform = 'scale(.9)';
    }
    setBusy(true);
    setPicked(q);
    const sig = `${tk.id}:${q}`;
    if (buyKey.current?.sig !== sig) buyKey.current = { sig, k: uid() };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    try {
      await post('/api/boost', { ticket: tk.id, qty: q }, buyKey.current.k);
      buyKey.current = null;
      triggerHaptic('success');
      pop(bb, bubRgb(tk.price), `+${q} x $${whole(tk.price)}`);
      const fresh = refresh().catch(() => {});
      await wait(450);
      show(t('bst.bought', { q, p: whole(tk.price), t: whole(tk.price * q) }));
      await wait(700);
      await fresh;
      setFan(null);
    } catch (err) {
      if (err.status) buyKey.current = null;
      triggerHaptic('error');
      show(err.status ? err.message : t('common.noConnection'));
      closeFan();
    } finally {
      setPicked(null);
      setBusy(false);
      revalidate('/api/wallet').catch(() => {});
    }
  }

  const map = slotMap.current;
  const live = new Set(running.map((b) => b.id));
  for (const id of [...map.keys()]) if (!live.has(id)) map.delete(id);
  const used = new Set(map.values());
  [...running]
    .sort((a, b) => a.startAt - b.startAt)
    .forEach((b) => {
      if (map.has(b.id)) return;
      for (let i = 0; i < SLOTS; i++) {
        if (!used.has(i)) {
          map.set(b.id, i);
          used.add(i);
          break;
        }
      }
    });
  const slots = Array.from({ length: SLOTS }, () => null);
  running.forEach((b) => {
    const i = map.get(b.id);
    if (i !== undefined) slots[i] = b;
  });
  const next = running.reduce((a, b) => (!a || b.endsAt < a.endsAt ? b : a), null);
  const picked_ = running.find((b) => b.id === focus) || null;
  const nextIn = next ? (Math.ceil((next.endsAt - now) / 60000) <= 1 ? t('bst.underLow') : left(t, next.endsAt - now)) : '';

  const finished = (data.finished || []).slice(0, 3);
  const au = data.enabled && data.auto?.available ? data.auto : null; // auto buy, shown only while the admin has it on
  const t1 = data.tickets.find((x) => x.id === 't1');
  const pickQ = aq ?? au?.qty ?? 1;
  const fanTk = fan ? data.tickets.find((x) => x.id === fan.id) : null;
  return (
    <div className={ph ? 'card ld' : 'card'} aria-busy={ph || undefined}>
      <h3>{t('boost.title')}</h3>
      <p className="mute" style={{ fontSize: '13px', margin: '4px 0 0' }}>{t('bst.sub', { h: data.hours })}</p>
      {running.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <style>{'@keyframes boostPulse{0%,100%{opacity:.25}50%{opacity:1}}.boost-pulse{animation:boostPulse 2s ease-in-out infinite}@keyframes boostFlow{0%{transform:translateY(22px);opacity:0}15%{opacity:.3}85%{opacity:.3}100%{transform:translateY(-100px);opacity:0}}.boost-flow{animation:boostFlow 8s linear infinite}.boost-off .boost-flow,.boost-off .boost-pulse{animation-play-state:paused}'}</style>
          <svg ref={dialRef} className={seen ? undefined : 'boost-off'} viewBox="0 0 300 300" role="img" aria-label={t('bst.running', { n: running.length })} style={{ display: 'block', width: 300, maxWidth: '100%', margin: '0 auto' }} onClick={() => setFocus(null)}>
            {slots.map((b, i) => {
              const a1 = i * 18 + 1;
              const a2 = i * 18 + 17;
              if (!b) return <path key={`e${i}`} d={wedge(R1, R2, a1, a2)} fill="none" stroke="var(--border-strong)" strokeWidth="0.5" strokeDasharray="3 3" />;
              const p = Math.max(0, Math.min(1, (now - b.startAt) / (b.endsAt - b.startAt)));
              const tc = tier(b.price);
              const on = focus === b.id;
              return (
                <g
                  key={b.id}
                  style={{ cursor: 'pointer', opacity: focus !== null && !on && picked_ ? 0.25 : 1, transition: 'opacity .25s' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setFocus(on ? null : b.id);
                  }}
                >
                  <path d={wedge(R1, R2, a1, a2)} fill="currentColor" fillOpacity="0.06" stroke={on ? 'currentColor' : 'var(--border-strong)'} strokeWidth={on ? 1.5 : 0.5} />
                  {p > 0 && <path d={wedge(R1, R1 + (R2 - R1) * p, a1, a2)} fill={tc.c} />}
                  <clipPath id={`bf${i}`}>
                    <path d={wedge(R1, R2, a1, a2)} />
                  </clipPath>
                  <g clipPath={`url(#bf${i})`} style={{ pointerEvents: 'none' }}>
                    <g transform={`rotate(${i * 18 + 9} 150 150)`}>
                      <rect className="boost-flow" x="120" y="82" width="60" height="22" fill="#fff" style={{ animationDelay: `-${(i * 0.47).toFixed(2)}s` }} />
                    </g>
                  </g>
                  <path d={rim(R2 + 6, a1 + 1, a2 - 1)} fill="none" stroke={tc.c} strokeWidth={tc.w} strokeLinecap="round" className={next && b.id === next.id && !picked_ ? 'boost-pulse' : undefined} />
                </g>
              );
            })}
            <circle cx="150" cy="150" r={R1 + (R2 - R1) / 2} fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="0.6" strokeDasharray="2 4" style={{ pointerEvents: 'none' }} />
            <text x="150" y={picked_ ? 154 : 152} textAnchor="middle" fontSize={picked_ ? 20 : 26} fontWeight="500" fill="currentColor" style={{ pointerEvents: 'none' }}>
              {picked_ ? left(t, picked_.endsAt - now) : running.length}
            </text>
            <text x="150" y="170" textAnchor="middle" fontSize="11" fill="currentColor" fillOpacity="0.65" style={{ pointerEvents: 'none' }}>
              {picked_ ? t('bst.boostN', { n: whole(picked_.price) }) + (picked_.gift ? ` · ${t('bst.free')}` : '') : t('bst.runningLbl')}
            </text>
          </svg>
          <p className="mute" style={{ textAlign: 'center', fontSize: '13px', margin: '4px 0 0' }}>{t('bst.nextEnds', { when: nextIn })}</p>
        </div>
      )}
      {finished.map((b) => (
        <div className="row" key={b.id}>
          <span className="mute">{t('bst.boostN', { n: whole(b.price) })}{b.gift ? ` · ${t('bst.free')}` : ''}</span>
          {b.win ? <b style={{ color: 'var(--green)' }}>{t('bst.won', { n: whole(b.prize) })}</b> : <b className="v">{t('bst.noPrize', { n: usd(b.pay) })}</b>}
        </div>
      ))}
      {data.enabled && (
        <div
          ref={btnRef}
          className={btnSeen ? undefined : 'free-off'}
          style={{ position: 'relative', display: 'grid', gridTemplateColumns: `repeat(${data.tickets.length}, 1fr)`, gap: 8, marginTop: 12, WebkitTapHighlightColor: 'transparent' }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeFan();
          }}
        >
          <style>{'@keyframes freeRipple{0%{transform:scale(1);opacity:.7}100%{transform:scale(1.14,1.35);opacity:0}}.free-ring{position:absolute;inset:0;border:1.5px solid var(--gold);border-radius:999px;pointer-events:none}.free-ring::after{content:"";position:absolute;inset:-1.5px;border:1.5px solid var(--gold);border-radius:inherit;animation:freeRipple 1.8s ease-out infinite}.free-off .free-ring::after{animation-play-state:paused}'}</style>
          <style>{BUB_CSS}</style>
          {data.tickets.map((tk) => {
            const free = tk.id === 't1' && freeN > 0;
            const open = fan?.id === tk.id && !out;
            return (
              <div key={tk.id} style={{ position: 'relative' }}>
                <button type="button" className={open && !free ? 'btn' : 'swap'} style={{ width: '100%', margin: 0, padding: '0 8px', minHeight: 44, ...(free ? { fontSize: 13 } : null) }} disabled={busy || (!free && tk.active >= tk.max)} onClick={(e) => (free ? spendFree() : toggle(tk, e))}>
                  {free ? t('bst.useFree') : tk.active >= tk.max ? t('bst.full') : t('bst.buyN', { n: whole(tk.price) })}
                </button>
                {free && <i className="free-ring" aria-hidden="true" />}
              </div>
            );
          })}
          {fan &&
            fanTk &&
            BUY_QTY.map((q, k) => {
              const fx = fan.cx + DX[k];
              const fy = TOP[k] - LIFT + BUB / 2;
              const mine = picked === q;
              const gone = out || (picked !== null && !mine);
              return (
                <button
                  key={`${fan.id}-${q}`}
                  type="button"
                  className={gone ? 'bbl bbl-gone' : 'bbl'}
                  data-off={fan.act + q > fanTk.max ? '1' : undefined}
                  aria-label={t('bst.bubbleAria', { q, t: whole(fanTk.price * q) })}
                  style={{ left: fx - BUB / 2, top: TOP[k] - LIFT, '--c': bubRgb(fanTk.price), '--k': k, '--sx': `${fan.from - fx}px`, '--sy': `${BTN_MID - fy}px`, ...(mine ? { pointerEvents: 'none' } : null) }}
                  onClick={(e) => buyQ(fanTk, q, e)}
                >
                  <span className="bbl-in">
                    <b>x{q}</b>
                    <small>${whole(fanTk.price * q)}</small>
                  </span>
                </button>
              );
            })}
        </div>
      )}
      {data.enabled &&
        data.tickets.map((tk) => (
          <div className="row" key={tk.id}>
            <div>
              <b>${whole(tk.price)}</b> · {whole(tk.th)} TH/s{tk.coin ? ` · ${tk.coin}` : ''}
              <small style={{ display: 'block' }}>{t('bst.always', { pay: usd(tk.pay), chance: tk.chance, prize: whole(tk.prize) })}</small>
            </div>
          </div>
        ))}
      {au && t1 && (
        <div style={{ marginTop: 12 }}>
          <div className="row">
            <div>
              <b>{t('bst.auto')}</b>
              <small style={{ display: 'block' }}>{t(au.on ? 'bst.autoSubOn' : 'bst.autoSub', { n: pickQ, p: whole(t1.price), t: whole(t1.price * pickQ) })}</small>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${au.max}, 1fr)`, gap: 8, marginTop: 8 }}>
            {Array.from({ length: au.max }, (_, i) => i + 1).map((q) => (
              <button
                key={q}
                type="button"
                className={q === pickQ ? 'btn' : 'swap'}
                style={{ margin: 0, padding: 0, minHeight: 44 }}
                disabled={autoBusy}
                onClick={() => {
                  setAq(q);
                  if (au.on) saveAuto(true, q);
                }}
              >
                {q}
              </button>
            ))}
          </div>
          <button type="button" className={au.on ? 'swap' : 'btn'} style={{ width: '100%', margin: '8px 0 0', minHeight: 44 }} disabled={autoBusy} onClick={() => saveAuto(!au.on, pickQ)}>
            {au.on ? t('bst.autoTurnOff') : t('bst.autoTurnOn')}
          </button>
        </div>
      )}
      <p className="fine" style={{ margin: '12px 0 0' }}>{t('bst.fine')}</p>
    </div>
  );
}
