'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { plans, halls, contracts, CUSTOM, customPlan, thFromPos, fmtTh, fmtUsd, BTC_USD } from '@/lib/data';
import { formatSerial, serialNumber } from '@/lib/contracts';
import { useApi, post, revalidate } from '@/lib/api';
import RigArt, { rigFor } from '@/components/RigArt';
import { useToast } from '@/components/Toast';
import { triggerHaptic } from '@/lib/haptics';
import { markDrill, useSheetBack } from '@/lib/nav';

const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

// Used only until the server answers the first time.
const seedMiners = { contracts, nextSerial: formatSerial(Math.max(...contracts.map((c) => serialNumber(c.serial))) + 1) };

export default function Plans() {
  // Catalogue and miners come from the cached API: instant from cache, refreshed quietly.
  const { data: cat } = useApi('/api/plans', { ttl: 20000 });
  const { data: md, refresh } = useApi('/api/miners', { ttl: 10000 });
  const { data: wd } = useApi('/api/wallet', { ttl: 10000 });
  const { data: pd } = useApi('/api/prices', { ttl: 30000 });
  const { data: ord, refresh: refreshOrders } = useApi('/api/orders', { ttl: 10000 });
  const planList = cat ? cat.plans : plans;
  const hallMap = cat ? cat.halls : halls;
  const list = md ? md.contracts : contracts;
  const nextId = md ? md.nextSerial : seedMiners.nextSerial;

  const [sel, setSel] = useState(null);
  const [pos, setPos] = useState(666); // slider position, about 100 TH/s
  const [term, setTerm] = useState(180);
  const stop = (e) => e.stopPropagation(); // keep slider drags from dragging the sheet
  // Tiles are cards with a button role, so they look like every other card.
  const press = (fn) => (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fn();
    }
  };
  const [tab, setTab] = useState('buy');
  const [dragY, setDragY] = useState(0);
  const [busy, setBusy] = useState(false);
  const [toast, show] = useToast();
  const sheetRef = useRef(null);
  const openerRef = useRef(null);
  const startY = useRef(null);
  // The plan on the sheet: a catalogue plan, or a custom one priced from the slider and term.
  const cur = sel ? (sel.id === 'custom' ? customPlan(thFromPos(pos), term, hallMap) : sel) : null;
  const hall = cur ? hallMap[cur.hall] : null;
  // The balance that can pay for a plan, in USD at the live rate (the server checks again with its own rate).
  const balUsd = wd ? Math.max(0, wd.earned - wd.withdrawn - (wd.spent || 0)) * (pd?.prices?.btc ?? BTC_USD) : 0;
  const canBal = !!cur && balUsd >= cur.price;
  const crypto = !!ord?.crypto;
  const methods = canBal ? ['balance', ...(crypto ? ['crypto'] : [])] : crypto ? ['crypto'] : ['balance'];

  function selectPlan(p) {
    triggerHaptic('selection');
    openerRef.current = document.activeElement;
    setSel(p);
  }

  // Close the sheet and give focus back to the tile that opened it.
  function dismiss() {
    setSel(null);
    setDragY(0);
    startY.current = null;
    const el = openerRef.current;
    if (el && el.focus) el.focus();
  }

  function closeModal() {
    triggerHaptic('light');
    dismiss();
  }

  const pending = (ord?.orders || []).filter((o) => o.status === 'pending');
  const review = (ord?.orders || []).filter((o) => o.status === 'review');

  // Pays by the chosen method. Balance and the demo account activate at once; crypto leaves for the payment page.
  async function pay(method) {
    if (busy) return;
    const plan = cur;
    setBusy(true);
    let leaving = false;
    try {
      const body = plan.id === 'custom' ? { planId: 'custom', th: plan.th, days: plan.days, pay: method } : { planId: plan.id, pay: method };
      const r = await post('/api/plans/buy', body, uid());
      if (r.pending && r.order?.url) {
        leaving = true;
        window.location.assign(r.order.url);
        return;
      }
      if (r.pending && r.order?.address) {
        await refreshOrders().catch(() => {});
        show('Send the exact BTC amount to the address shown.');
        dismiss();
        return;
      }
      await refresh().catch(() => {});
      triggerHaptic('success');
      show(`${plan.name} plan activated`);
      dismiss();
    } catch (e) {
      triggerHaptic('error');
      show(e.status ? e.message : 'No connection. Try again.');
    } finally {
      if (!leaving) {
        setBusy(false);
        revalidate('/api/wallet').catch(() => {});
        refreshOrders().catch(() => {});
      }
    }
  }

  async function cancelOrder(id) {
    triggerHaptic('light');
    try {
      await post('/api/orders/cancel', { id });
    } catch (e) {
      show(e.status ? e.message : 'No connection. Try again.');
    }
    refreshOrders().catch(() => {});
  }

  // While a payment is open, check for it every few seconds. When one turns paid, say so and refresh the miners.
  const seen = useRef(new Set());
  useEffect(() => {
    if (!pending.length) return undefined;
    const t = setInterval(() => refreshOrders().catch(() => {}), 5000);
    return () => clearInterval(t);
  }, [pending.length]);
  useEffect(() => {
    if (!ord) return;
    const ids = new Set(pending.map((o) => o.id));
    for (const id of seen.current) {
      if (!ids.has(id) && ord.orders.find((o) => o.id === id)?.status === 'paid') {
        triggerHaptic('success');
        show('Payment received. Your miner is live.');
        refresh().catch(() => {});
        revalidate('/api/wallet').catch(() => {});
      }
    }
    seen.current = ids;
  }, [ord]);

  useSheetBack(!!sel, dismiss);

  // Coming back from a miner page: reopen on the My miners tab.
  useEffect(() => {
    try {
      if (sessionStorage.getItem('opus-plans-tab') === 'mine') {
        sessionStorage.removeItem('opus-plans-tab');
        setTab('mine');
      }
    } catch {}
  }, []);

  function openMiner() {
    try {
      sessionStorage.setItem('opus-plans-tab', 'mine');
    } catch {}
    markDrill();
  }

  // While the sheet is open: Escape closes, Tab stays inside, page behind does not scroll.
  useEffect(() => {
    if (!sel) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeModal();
      } else if (e.key === 'Tab') {
        const f = sheetRef.current ? sheetRef.current.querySelectorAll('button, [href], input, [tabindex]:not([tabindex="-1"])') : [];
        if (!f.length) return;
        const first = f[0];
        const lastEl = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [sel]);

  return (
    <>
      <div className="top">
        <h2>Plans</h2>
      </div>

      <div className="tabs" role="group" aria-label="Buy plans or your miners">
        <button aria-pressed={tab === 'buy'} onClick={() => setTab('buy')}>Buy plans</button>
        <button aria-pressed={tab === 'mine'} onClick={() => setTab('mine')}>My miners · {list.length}</button>
      </div>

      {tab === 'buy' && [...pending, ...review].map((o) => (
        <div key={o.id} className="card">
          <div className="row" style={{ borderTop: 0 }}>
            <div>
              <b>{o.status === 'review' ? 'Payment needs a check' : 'Waiting for payment'}</b>
              <small style={{ display: 'block' }}>{o.label} · ${fmtUsd(o.usd)}</small>
              {o.status === 'pending' && o.address && (
                <>
                  <small style={{ display: 'block' }}>Send exactly <b>{o.amount} BTC</b> to</small>
                  <small className="serial" style={{ display: 'block', wordBreak: 'break-all', userSelect: 'all' }}>{o.address}</small>
                </>
              )}
            </div>
            {o.status === 'pending' && (
              <div>
                {o.url && <a className="linkbtn" href={o.url} style={{ display: 'inline-flex', alignItems: 'center' }}>Pay</a>}
                {o.uri && <a className="linkbtn" href={o.uri} style={{ display: 'inline-flex', alignItems: 'center' }}>Open wallet</a>}
                <button type="button" className="linkbtn" onClick={() => cancelOrder(o.id)}>Cancel</button>
              </div>
            )}
          </div>
        </div>
      ))}

      {tab === 'buy' ? (
      <div className="tiles">
        {planList.map((p) => {
          const a = rigFor({ plan: p.id, th: p.th });
          return (
            <div
              key={p.id}
              role="button"
              tabIndex={0}
              className={`card tile ${p.featured ? 'feat' : ''}`}
              onClick={() => selectPlan(p)}
              onKeyDown={press(() => selectPlan(p))}
              aria-label={`${p.name}, ${p.th} terahash, $${p.price}`}
            >
              {p.featured && <span className="tag">Most chosen</span>}
              <RigArt kind={a.kind} units={a.units} speed={a.speed} id={p.id} />
              <div className="tname">{p.name}<span>{p.th} TH/s</span></div>
              <div className="tprice">${p.price.toLocaleString()}</div>
              <div className="tmeta">{p.days} days · <b>~{p.daily}</b>/day</div>
            </div>
          );
        })}
        <div role="button" tabIndex={0} className="card tile" onClick={() => selectPlan({ id: 'custom' })} onKeyDown={press(() => selectPlan({ id: 'custom' }))} aria-label="Custom power, choose your own size and term">
          <div className="tname">Custom<span>{CUSTOM.min}–{CUSTOM.max} TH/s</span></div>
          <div className="tprice">From ${fmtUsd(customPlan(CUSTOM.min, CUSTOM.terms[0], hallMap).price)}</div>
          <div className="tmeta">Choose your own power and term</div>
        </div>
      </div>
      ) : list.length ? (
        <div className="clist">
          {list.map((c) => {
            const pct = Math.round((c.elapsed / c.days) * 100);
            const rig = rigFor(c);
            return (
              <Link key={c.serial} href={`/miners/${c.serial}`} onClick={openMiner} className="card cl">
                <div className="mrow">
                  <RigArt units={rig.units} speed={rig.speed} id={c.serial} />
                  <div className="mi">
                    <div className="mt">
                      <i className={`sdot${c.online ? '' : ' off'}`} />
                      <b>{c.plan}</b>
                      <svg className="go" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
                    </div>
                    <span className="serial">{c.serial}</span>
                    <div className="mchips">
                      <span>{c.th} TH/s</span>
                      <span>{hallMap[c.hall].efficiency}</span>
                      <span className="up">+${c.dailyUsd.toFixed(2)}/day</span>
                    </div>
                  </div>
                </div>
                <div className="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                  <i style={{ width: `${pct}%` }} />
                </div>
                <div className="cmeta">
                  <span>Day {c.elapsed}/{c.days}</span>
                  <span>Ends {c.ends}</span>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="card">
          <p className="empty">No miners yet.</p>
          <button className="swap" onClick={() => setTab('buy')}>Buy a plan</button>
        </div>
      )}

      {sel && (
        <div
          className="sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="st"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div
            className="card"
            ref={sheetRef}
            style={dragY ? { transform: `translateY(${dragY}px)`, transition: 'none' } : undefined}
            onTouchStart={(e) => {
              startY.current = e.touches[0].clientY;
            }}
            onTouchMove={(e) => {
              if (startY.current === null) return;
              setDragY(Math.max(0, e.touches[0].clientY - startY.current));
            }}
            onTouchEnd={() => {
              if (dragY > 90) closeModal();
              else setDragY(0);
              startY.current = null;
            }}
          >
            <div className="grab" aria-hidden="true" />
            <h3 id="st">{cur.id === 'custom' ? 'Custom power' : `${cur.name} plan`}</h3>
            {cur.id === 'custom' ? (
              <div className="slide">
                <div className="big"><b>{fmtTh(cur.th)} TH/s</b><span>~{cur.daily}/day</span></div>
                <input
                  type="range"
                  min="0"
                  max="1000"
                  step="1"
                  value={pos}
                  aria-label="Hash power in terahash"
                  aria-valuetext={`${fmtTh(cur.th)} terahash`}
                  style={{ '--p': `${pos / 10}%` }}
                  onChange={(e) => setPos(+e.target.value)}
                  onTouchStart={stop}
                  onTouchMove={stop}
                  onTouchEnd={stop}
                />
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
            ) : (
              <p className="mute" style={{ fontSize: '13px', margin: '4px 0 0' }}>{cur.blurb}</p>
            )}
            <div className="sheetbody">
              <div className="row">
                <span className="mute">Hall</span>
                <b className="v">{hall.name}<small>{hall.power}</small></b>
              </div>
              <div className="row">
                <span className="mute">Rig</span>
                <b className="v">{hall.rig}<small>{hall.efficiency}</small></b>
              </div>
              <div className="row">
                <span className="mute">Miner ID</span>
                <b className="serial">{nextId}</b>
              </div>
              <div className="row" style={{ borderTop: '1px solid rgba(233, 196, 106, 0.25)' }}>
                <span className="mute" style={{ fontWeight: 600 }}>Total due</span>
                <b style={{ color: 'var(--gold2)', fontSize: '20px' }}>${fmtUsd(cur.price)}</b>
              </div>
            </div>
            {!ord?.demo && (
              <div className="sheetbody" style={{ marginTop: -4 }}>
                <div className="row">
                  <span className="mute">Your balance</span>
                  <b className="v">${fmtUsd(balUsd)}</b>
                </div>
              </div>
            )}
            <p className="fine" style={{ margin: '-8px 0 12px' }}>
              ~{cur.daily}/day is an estimate after electricity and maintenance. Real payouts follow BTC price and network difficulty.
              {ord?.demo
                ? ' Demo account: nothing is charged.'
                : !canBal && !crypto
                  ? ' Not enough balance, and crypto payments are not switched on yet.'
                  : !canBal
                    ? ` Balance is $${fmtUsd(cur.price - balUsd)} short.`
                    : ''}
            </p>
            {ord?.demo ? (
              <button className="btn" autoFocus onClick={() => pay('demo')} disabled={busy}>Confirm &amp; Pay</button>
            ) : (
              methods.map((m, i) => (
                <button key={m} className={i === 0 ? 'btn' : 'swap'} autoFocus={i === 0} onClick={() => pay(m)} disabled={busy || (m === 'balance' && !canBal)}>
                  {m === 'balance' ? 'Pay from balance' : 'Pay with crypto'}
                </button>
              ))
            )}
            <button className="swap" type="button" onClick={closeModal}>Cancel</button>
          </div>
        </div>
      )}
      {toast}
    </>
  );
}
