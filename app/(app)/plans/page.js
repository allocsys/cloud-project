'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { halls, contracts, CUSTOM, customPlan, thFromPos, fmtTh, fmtUsd, BTC_USD, MIN_WITHDRAW_USD } from '@/lib/data';
import { formatSerial, serialNumber } from '@/lib/contracts';
import { useApi, post, revalidate } from '@/lib/api';
import RigArt, { rigFor } from '@/components/RigArt';
import { AsicsCard, SmartCard } from '@/components/PowerCards';
import { useToast } from '@/components/Toast';
import { triggerHaptic } from '@/lib/haptics';
import { markDrill, useSheetBack } from '@/lib/nav';
import { posFromTh, SLIDER_SIZES } from '@/lib/reinvest';
import { budgetFromPos, posFromBudget } from '@/lib/tiers';
import { dailyCosts, fmtCost } from '@/lib/fees';
import { liveDaily } from '@/lib/market';
import { SMART, smartPlan, smartBand } from '@/lib/smart';
import { applyFirstBonus, bonusText } from '@/lib/first-bonus';

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
  const hallMap = cat ? cat.halls : halls;
  // What a plan is expected to pay per day at today's market (the catalogue's static label until the server answers).
  const dailyOf = (p) => {
    if (p.smart) return p.daily;
    const v = liveDaily(p.th, hallMap[p.hall], cat?.live);
    return v === null ? p.daily : `$${v.toFixed(2)}`;
  };
  const list = md ? md.contracts : contracts;
  const nextId = md ? md.nextSerial : seedMiners.nextSerial;

  const [sel, setSel] = useState(null);
  const [pos, setPos] = useState(666); // ASICs slider position, about 100 TH/s
  const [aterm, setAterm] = useState(180); // ASICs term
  const [term, setTerm] = useState(120); // Smart Mining term
  const [budget, setBudget] = useState('500'); // Smart Mining budget as typed, in dollars
  const [spos, setSpos] = useState(() => posFromBudget(500)); // Smart Mining slider position
  const [tab, setTab] = useState('buy');
  const [dragY, setDragY] = useState(0);
  const [busy, setBusy] = useState(false);
  const [toast, show] = useToast();
  const sheetRef = useRef(null);
  const openerRef = useRef(null);
  const startY = useRef(null);
  // What the two cards show, and what the sheet confirms: the ASICs pick and the Smart Mining pick.
  const bNum = Math.min(SMART.max, Math.max(SMART.min, Math.round(Number(budget)) || SMART.min));
  const ap = customPlan(thFromPos(pos), aterm, hallMap);
  const sp = smartPlan(bNum, term, cat?.smartTable);
  // The plan on the sheet: Smart Mining or an ASICs pick.
  const cur = sel ? (sel.id === 'smart' ? sp : sel.id === 'custom' ? ap : sel) : null;
  const hall = cur ? hallMap[cur.hall] || null : null;
  const costs = cur && hall ? dailyCosts(cur.th, hall) : null; // already taken out of the mining, never billed
  // Smart Mining: the profit a day is held between the bottom and the top of the reserve band (lib/smart.js), so the term's profit
  // is estimated as that band over the whole term. An estimate, not a promise: a weak market can pay less, a strong one more.
  const money = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const profitRange = cur?.smart ? smartBand(cur) : null; // { low, mid, high } from lib/smart.js
  // The balance that can pay for a plan, in USD at the live rate (the server checks again with its own rate).
  const balUsd = wd ? Math.max(0, wd.earned - wd.withdrawn - (wd.spent || 0)) * (pd?.prices?.btc ?? BTC_USD) : 0;
  const canBal = !!cur && balUsd >= cur.price;
  const crypto = !!ord?.crypto;
  const methods = canBal ? ['balance', ...(crypto ? ['crypto'] : [])] : crypto ? ['crypto'] : ['balance'];
  // The first-buy bonus is shown when crypto is the only way to pay (a first buy from the balance gets none).
  const fb = cur && md?.firstBonus && crypto && !canBal ? applyFirstBonus(md.firstBonus, cur) : null;

  // Smart Mining amount box and slider keep each other in step.
  const onAmount = (v) => {
    setBudget(v);
    const n = Math.round(Number(v));
    if (Number.isFinite(n) && n >= SMART.min) setSpos(posFromBudget(n));
  };
  const onAmountBlur = () => {
    setBudget(String(bNum));
    setSpos(posFromBudget(bNum));
  };
  const onSlide = (v) => {
    setSpos(v);
    setBudget(String(budgetFromPos(v)));
  };

  function selectPlan(p) {
    triggerHaptic('selection');
    openerRef.current = document.activeElement;
    setSel(p);
  }

  // Close the sheet and give focus back to the button that opened it.
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
      const body = plan.smart
        ? { planId: 'smart', budget: plan.budget, days: plan.days, pay: method }
        : plan.id === 'custom'
          ? { planId: 'custom', th: plan.th, days: plan.days, pay: method }
          : { planId: plan.id, pay: method };
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
      show(plan.smart ? 'Smart Mining started' : plan.id === 'custom' ? 'ASICs miner activated' : `${plan.name} plan activated`);
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

  // Coming from a Reinvest card or the calculator: /plans?plan=<id> opens that plan's sheet once the catalogue has loaded.
  // /plans?plan=custom&th=24&days=180 sets the ASICs card to that size and term and opens its sheet.
  // /plans?plan=smart&budget=500&days=120 does the same for Smart Mining.
  const deepPlan = useRef(null);
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      const id = q.get('plan');
      if (id) {
        deepPlan.current = { id, th: parseFloat(q.get('th')), days: parseInt(q.get('days'), 10), budget: parseInt(q.get('budget'), 10) };
        window.history.replaceState(null, '', window.location.pathname);
      }
    } catch {}
  }, []);
  useEffect(() => {
    if (!deepPlan.current || !cat) return;
    const { id, th, days, budget: b } = deepPlan.current;
    deepPlan.current = null;
    if (id === 'smart') {
      setTab('buy');
      if (Number.isInteger(b)) {
        const n = Math.min(SMART.max, Math.max(SMART.min, b));
        setBudget(String(n));
        setSpos(posFromBudget(n));
      }
      if (SMART.terms.includes(days)) setTerm(days);
      setSel({ id: 'smart' });
      return;
    }
    if (id === 'custom') {
      setTab('buy');
      if (SLIDER_SIZES.includes(th)) setPos(posFromTh(th));
      if (CUSTOM.terms.includes(days)) setAterm(days);
      setSel({ id: 'custom' });
    }
  }, [cat]);

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
      <>
      {cat?.smartOn !== false && (
        <SmartCard
          budget={budget}
          bNum={bNum}
          spos={spos}
          term={term}
          setTerm={setTerm}
          plan={sp}
          within={balUsd >= sp.price}
          onAmount={onAmount}
          onAmountBlur={onAmountBlur}
          onSlide={onSlide}
          onBuy={() => selectPlan({ id: 'smart' })}
        />
      )}
      <AsicsCard
        pos={pos}
        setPos={setPos}
        term={aterm}
        setTerm={setAterm}
        plan={ap}
        daily={dailyOf(ap)}
        hall={hallMap[ap.hall] || null}
        within={balUsd >= ap.price}
        onBuy={() => selectPlan({ id: 'custom' })}
      />
      </>
      ) : list.length ? (
        <div className="clist">
          {list.map((c) => {
            const pct = Math.round((c.elapsed / c.days) * 100);
            const rig = rigFor(c);
            return (
              <Link key={c.serial} href={`/miners/${c.serial}`} onClick={openMiner} className="card cl">
                <div className="crow">
                  <RigArt units={rig.units} speed={rig.speed} id={c.serial} />
                  <div className="mi">
                    <div className="mt">
                      <i className={`sdot${c.online && !c.paused ? '' : ' off'}`} />
                      <b>{c.plan}</b>
                      <svg className="go" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
                    </div>
                    <span className="serial">{c.serial}</span>
                    <div className="mchips">
                      <span>{c.smart ? `$${fmtUsd(c.budget)} budget` : `${c.th} TH/s`}</span>
                      <span>{c.smart ? 'Best coin daily' : hallMap[c.hall].efficiency}</span>
                      {c.paused ? <span>Paused today</span> : <span className="up">+${c.dailyUsd.toFixed(2)}/day</span>}
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
            <h3 id="st">{cur.smart ? 'Smart Mining' : cur.id === 'custom' ? 'ASICs' : `${cur.name} plan`}</h3>
            <p className="mute" style={{ fontSize: '13px', margin: '4px 0 0' }}>
              {cur.smart
                ? `$${fmtUsd(cur.budget)} for ${cur.days} days. We pick the most profitable coin for you every day. Paid in BTC.`
                : cur.id === 'custom'
                  ? `${fmtTh(cur.th)} TH/s for ${cur.days} days.`
                  : cur.blurb}
            </p>
            <div className="sheetbody">
              {hall ? (
                <>
                  <div className="row">
                    <span className="mute">Hall</span>
                    <b className="v">{hall.name}<small>{hall.power}</small></b>
                  </div>
                  <div className="row">
                    <span className="mute">Rig</span>
                    <b className="v">{hall.rig}<small>{hall.efficiency}</small></b>
                  </div>
                </>
              ) : null}
              {costs ? (
                <>
                  <div className="row">
                    <span className="mute">Electricity</span>
                    <b className="v">~${fmtCost(costs.elec)}/day<small>Taken out of your mining</small></b>
                  </div>
                  <div className="row">
                    <span className="mute">Maintenance</span>
                    <b className="v">~${fmtCost(costs.maint)}/day<small>Taken out of your mining</small></b>
                  </div>
                </>
              ) : null}
              <div className="row">
                <span className="mute">Miner ID</span>
                <b className="serial">{nextId}</b>
              </div>
              {fb && (
                <div className="row">
                  <span className="mute">First-buy bonus</span>
                  <b className="v" style={{ color: 'var(--green)' }}>+{bonusText(fb.bonus)} extra hashrate<small>for the full term</small></b>
                </div>
              )}
              <div className="row" style={{ borderTop: '1px solid rgba(233, 196, 106, 0.25)' }}>
                <span className="mute" style={{ fontWeight: 600 }}>Total due</span>
                <b style={{ color: 'var(--gold2)', fontSize: '20px' }}>${fmtUsd(cur.price)}</b>
              </div>
              <div className="row">
                <span className="mute">Your balance</span>
                <b className="v">${fmtUsd(balUsd)}</b>
              </div>
              {profitRange && (
                <div className="row">
                  <span className="mute">Est. profit by term end</span>
                  <b className="v" style={{ color: 'var(--green)' }}>About ${money(profitRange.mid)}<small>Range ${money(profitRange.low)} to ${money(profitRange.high)}</small></b>
                </div>
              )}
              {profitRange && (
                <div className="row">
                  <span className="mute">Est. total by term end</span>
                  <b className="v">About ${money(cur.budget + profitRange.mid)}<small>Budget + profit</small></b>
                </div>
              )}
            </div>
            <p className="fine" style={{ margin: '-8px 0 12px' }}>
              ~{dailyOf(cur)}/day. All figures are estimates, not a promise. Withdraw from ${MIN_WITHDRAW_USD} (<Link href="/terms">Terms</Link>).
            </p>
            {(!canBal || !crypto) && (!canBal) && (
              <p className="fine" style={{ margin: '-4px 0 12px' }}>
                {!crypto
                  ? 'Not enough balance, and crypto payments are not switched on yet.'
                  : `Balance is $${fmtUsd(cur.price - balUsd)} short.`}
              </p>
            )}
            {methods.map((m, i) => (
              <button key={m} className={i === 0 ? 'btn' : 'swap'} autoFocus={i === 0} onClick={() => pay(m)} disabled={busy || (m === 'balance' && !canBal)}>
                {m === 'balance' ? 'Pay from balance' : 'Pay with crypto'}
              </button>
            ))}
            <button className="swap" type="button" onClick={closeModal}>Cancel</button>
          </div>
        </div>
      )}
      {toast}
    </>
  );
}
